#!/usr/bin/env node
/**
 * Collab Audit — Collaborative codebase audit using Soren, Atlas, and Morgan personas.
 *
 * Usage:
 *   node c:\xampp\htdocs\claude-collab\collab-audit\audit.js <target-directory> [--focus areas] [--model opus] [--output path]
 *
 * Examples:
 *   node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\ai-ta
 *   node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\bandpilot --focus "security,performance"
 *   node c:\xampp\htdocs\claude-collab\collab-audit\audit.js . --output c:\audits\report.md
 *
 * Pipeline (default parallel mode):
 *   1-3. Soren (code), Atlas (architecture), Morgan (UX) scan codebase in parallel (Opus)
 *   4.   Exchange rounds — all three challenge/refine in parallel (Sonnet)
 *   5.   Atlas synthesizes final report (Opus)
 *
 * Use --sequential for the original pipeline where each phase sees prior findings.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Configuration ---

const CLAUDE_CLI_JS = (() => {
  if (process.env.CLAUDE_CLI_JS) return process.env.CLAUDE_CLI_JS;
  // Try npm global root (correct on Windows where global modules live in AppData)
  try {
    const { execSync } = require('child_process');
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const globalPath = path.join(globalRoot, '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(globalPath)) return globalPath;
  } catch (e) { /* fall through */ }
  // Fallback: co-located with node binary (Linux/macOS default installs)
  return path.join(path.dirname(process.execPath), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
})();
const PERSONAS_DIR = process.env.COLLAB_PERSONAS_DIR || 'c:\\claude-collab\\personas';
const DEFAULT_MODEL = 'opus';
const DEFAULT_EXCHANGE_MODEL = 'sonnet'; // Exchange rounds use faster model by default
const MAX_TURNS = 25;
const TIMEOUT_MS = 600000; // 10 minutes per invocation
const DEFAULT_EXCHANGES = 2; // Number of collaborative back-and-forth rounds
const CONTEXT_WINDOW_TOKENS = 200000;
const PERSONA_BUDGET_RATIO = 0.15; // Slightly lower than chatroom — leave room for codebase
const PERSONA_BUDGET_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * PERSONA_BUDGET_RATIO);

// --- Business context (from --context-note flag) ---
// Set once by parseArgs, read by every prompt builder via contextSection().
// Business context calibrates severity judgments — a SQL injection in an
// internal 3-user tool is not the same severity as one on a 50k-user SaaS.
let auditContextNote = '';

// Unified helper for the FOCUS AREAS + BUSINESS CONTEXT prompt section.
// Every prompt builder calls this instead of constructing focusSection inline.
function contextSection(focus) {
    const parts = [];
    if (focus) parts.push(`FOCUS AREAS (prioritize these): ${focus}`);
    if (auditContextNote) parts.push(`BUSINESS CONTEXT: ${auditContextNote}`);
    return parts.length ? '\n' + parts.join('\n') + '\n' : '';
}

// --- Finding annotation format ---
// Borrowed from Crob's source-aware confidence model: every audit finding carries
// a confidence tier and provenance trail so readers can weight findings by how
// well-corroborated they are across auditors. See crob/docs/FORMAT.md for the
// underlying epistemic model.
const ANNOTATED_FINDING_FORMAT = `
### Annotated Finding Format (REQUIRED for every finding)

Every finding in Critical/High/Medium/Low/UX sections MUST use this structure:

**[ID] Title**
- **Severity**: critical | high | medium | low — <one-line rationale: why this level and not a lower one, referencing business context if provided>
- **Evidence**: \`path/to/file.ext:123\`, \`other/file.ext:42-58\` (specific file:line refs)
- **Confidence**: \`provisional\` | \`observed\` | \`corroborated\` | \`disputed\`
- **Raised by**: which auditor first flagged it (Soren / Atlas / Morgan) and in which phase (initial / round N)
- **Agreement**: who corroborated, who challenged, final resolution if disputed
- **Description**: what is wrong and why it matters
- **Fix**: specific remediation with file:line references

**Severity rationale is required, not optional.** "High" with no reason is a lazy rating that readers cannot evaluate. "High because exposes customer emails on a public endpoint" is defensible — a reader can check whether the context matches and disagree if it does not. If BUSINESS CONTEXT was provided at the top of this prompt, severity rationales should cite it explicitly when relevant.

**Confidence tier rules**:
- \`provisional\`: one auditor flagged it with hedging language ("might", "possibly", "likely") OR without direct file verification. Treat as a hypothesis.
- \`observed\`: one auditor verified via file read/grep, no cross-auditor comment. Single-source fact.
- \`corroborated\`: 2+ auditors independently verified from different angles, OR one raised + another confirmed in an exchange round. This is the equivalent of Crob's +0.15 cross-source corroboration.
- \`disputed\`: at least one auditor pushed back on the finding. Show both sides in the Agreement line and state the final resolution. This is the equivalent of Crob's distinct_objects > 1 signal — surface it, don't average it away.

**Do not silently drop disputed findings.** If the team couldn't agree, say so and show the evidence each side cited. Human readers need to see disagreement to make their own call.

### Examples (follow this exact format)

**Example 1 — corroborated finding (Crob +0.15 equivalent)**

**[H1] SQL injection in user search endpoint**
- **Severity**: high — exposes customer email addresses on a public endpoint reachable without authentication (per business context, customer PII is the primary asset to protect)
- **Evidence**: \`api/search.php:42\`, \`api/search.php:58\`
- **Confidence**: corroborated
- **Raised by**: Soren (initial scan)
- **Agreement**: Atlas independently flagged the same line in round 1 after grepping for \`$_GET\` usage; Morgan confirmed user impact (exposes customer emails). Unanimous.
- **Description**: \`api/search.php:42\` concatenates \`$_GET['q']\` directly into a SQL string with no parameterization or escaping. An attacker can read or drop tables via crafted query parameters.
- **Fix**: Replace the raw concat with a prepared statement. \`$stmt = $pdo->prepare('SELECT * FROM users WHERE name LIKE ?'); $stmt->execute(['%' . $_GET['q'] . '%']);\`

**Example 2 — disputed finding (Crob distinct_objects > 1 equivalent)**

**[M3] Caching layer complexity may not be justified**
- **Severity**: medium — burdens developer experience and onboarding without breaking the system; a refactor would save time long-term but isn't urgent at current traffic
- **Evidence**: \`lib/cache/RedisStore.php:1-180\`, \`lib/cache/MemcachedStore.php:1-165\`, \`config/cache.php:12-45\`
- **Confidence**: disputed
- **Raised by**: Atlas (initial scan)
- **Agreement**: Atlas argued the dual-backend abstraction is over-engineered for current traffic (~500 req/day per logs). Soren pushed back in round 1, citing the migration plan in \`docs/SCALING.md:88\` that projects 10x growth by Q3 — the abstraction exists for that future. Morgan sided with Atlas on developer-experience grounds (new contributors have to learn both backends to debug anything). **Final resolution**: keep as-is, but document the growth assumption in \`lib/cache/README.md\` so the complexity is justified in-line. Soren's argument won on the technical merits, Morgan's concern stays valid as a documentation gap.
- **Description**: The codebase maintains parallel Redis and Memcached backends behind a \`CacheStoreInterface\`, with feature-parity enforcement tests. At current traffic this is ~250 lines of abstraction serving one active backend.
- **Fix**: Document the scaling justification in \`lib/cache/README.md\` (the "why" is currently only in a separate scaling doc). No code change required — the team agreed the abstraction stays.

**Example 3 — observed finding (single-source baseline)**

**[L4] Missing ARIA label on search icon button**
- **Severity**: low — blocks screen reader users from understanding the control, but the button is still reachable via keyboard and visible for sighted users; accessibility regression not a functional one
- **Evidence**: \`templates/header.php:24\`
- **Confidence**: observed
- **Raised by**: Morgan (initial scan)
- **Agreement**: Morgan verified with NVDA screen reader simulation. Soren and Atlas did not comment — accessibility is Morgan's lane and neither had reason to challenge.
- **Description**: The search icon in the header is a \`<button>\` with only an SVG child. Screen readers announce it as "button, button" with no context.
- **Fix**: Add \`aria-label="Search"\` to the button element at \`templates/header.php:24\`.

**Notice**: in Example 2, the team couldn't converge on one answer so the finding was marked \`disputed\` and both sides were documented. The \`Fix\` field still gives clear guidance (document the justification). Disputed does not mean "can't act" — it means "act with eyes open."
`;


// --- Argument parsing ---

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
Collab Audit / Plan — Collaborative codebase analysis and pre-flight planning with Soren, Atlas & Morgan

Usage:
  node audit.js <target-directory> [options]           — codebase audit
  node audit.js --plan "description" [options]         — pre-flight plan review
  node audit.js --plan-file path/to/plan.md [options]  — pre-flight plan review from file

Options:
  --plan "text"          Plan description (switches to plan review mode)
  --plan-file <path>     Read plan description from file
  --context <dir>        Codebase context directory for plan mode (optional)
  --focus "areas"        Comma-separated focus areas (e.g., "security,performance,ux")
  --context-note "text"  Business context for severity calibration (e.g., "Production SaaS, 50k users, PII = emails")
  --exchanges N          Number of exchange rounds (default: ${DEFAULT_EXCHANGES}, range: 1-6)
  --model <model>        Model for initial scans + synthesis (default: opus)
  --exchange-model <m>   Model for exchange rounds (default: sonnet). Use "opus" for max depth
  --output <path>        Output file path (default: <target>/audit-report.md or plan-review.md)
  --sequential           Disable parallel execution (run all phases sequentially)
  --only "names"         Comma-separated participant names (e.g., "morgan,atlas")
  --soren-only           Shorthand for --only soren
  --verbose              Show real-time progress
  --help, -h             Show this help

Examples:
  node audit.js c:\\xampp\\htdocs\\ai-ta
  node audit.js c:\\xampp\\htdocs\\bandpilot --focus "security,sql-injection,xss"
  node audit.js --plan "Add a real-time notification system to the dashboard" --context c:\\xampp\\htdocs\\myapp
  node audit.js --plan-file c:\\plans\\feature-spec.md --context c:\\xampp\\htdocs\\myapp
`);
        process.exit(0);
    }

    let planDescription = '';
    let contextDir = '';
    let targetDir = '';
    let focus = '';
    let model = DEFAULT_MODEL;
    let exchangeModel = DEFAULT_EXCHANGE_MODEL;
    let output = '';
    let exchanges = DEFAULT_EXCHANGES;
    let onlyParticipants = null; // null = all, Set of lowercase names = subset
    let verbose = false;
    let sequential = false;

    // First pass: detect plan mode flags before positional arg parsing
    const planFlagIdx = args.indexOf('--plan');
    const planFileFlagIdx = args.indexOf('--plan-file');
    const isPlanMode = planFlagIdx !== -1 || planFileFlagIdx !== -1;

    if (isPlanMode) {
        // Plan mode — no positional targetDir required
        for (let i = 0; i < args.length; i++) {
            switch (args[i]) {
                case '--plan': planDescription = args[++i] || ''; break;
                case '--plan-file': {
                    const planFile = args[++i] || '';
                    try { planDescription = fs.readFileSync(path.resolve(planFile), 'utf-8').trim(); }
                    catch (e) { console.error(`Error reading plan file: ${e.message}`); process.exit(1); }
                    break;
                }
                case '--context': contextDir = path.resolve(args[++i] || '.'); break;
                case '--context-note': auditContextNote = args[++i] || ''; break;
                case '--focus': focus = args[++i] || ''; break;
                case '--exchanges': exchanges = Math.min(6, Math.max(1, parseInt(args[++i]) || DEFAULT_EXCHANGES)); break;
                case '--model': model = args[++i] || DEFAULT_MODEL; break;
                case '--exchange-model': exchangeModel = args[++i] || DEFAULT_EXCHANGE_MODEL; break;
                case '--output': output = args[++i] || ''; break;
                case '--soren-only': onlyParticipants = new Set(['soren']); break;
                case '--only': onlyParticipants = new Set((args[++i] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)); break;
                case '--sequential': sequential = true; break;
                case '--verbose': verbose = true; break;
            }
        }
        if (!planDescription) { console.error('Error: --plan requires a description string'); process.exit(1); }
        if (!contextDir) contextDir = process.cwd();
        if (!output) output = path.join(contextDir, 'plan-review.md');
        targetDir = contextDir; // reuse targetDir for context in plan mode
    } else {
        // Audit mode — first positional arg is target directory
        targetDir = path.resolve(args[0]);
        for (let i = 1; i < args.length; i++) {
            switch (args[i]) {
                case '--focus': focus = args[++i] || ''; break;
                case '--context-note': auditContextNote = args[++i] || ''; break;
                case '--exchanges': exchanges = Math.min(6, Math.max(1, parseInt(args[++i]) || DEFAULT_EXCHANGES)); break;
                case '--model': model = args[++i] || DEFAULT_MODEL; break;
                case '--exchange-model': exchangeModel = args[++i] || DEFAULT_EXCHANGE_MODEL; break;
                case '--output': output = args[++i] || ''; break;
                case '--soren-only': onlyParticipants = new Set(['soren']); break;
                case '--only': onlyParticipants = new Set((args[++i] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)); break;
                case '--sequential': sequential = true; break;
                case '--verbose': verbose = true; break;
            }
        }
        if (!output) output = path.join(targetDir, 'audit-report.md');
    }

    // Validate --only names
    const validNames = new Set(['soren', 'atlas', 'morgan']);
    if (onlyParticipants) {
        for (const name of onlyParticipants) {
            if (!validNames.has(name)) {
                console.error(`Error: Unknown participant "${name}". Valid: soren, atlas, morgan`);
                process.exit(1);
            }
        }
    }

    return { targetDir, focus, model, exchangeModel, output, exchanges, onlyParticipants, verbose, sequential, planDescription, isPlanMode };
}

// --- Persona loader (extracted from watcher/persona.js) ---

function extractLayer(personaText, layerName) {
    const pattern = new RegExp(
        `## ${layerName}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n---\\n|\\n## Layer|\\n## Identity|$)`,
        'i'
    );
    const match = personaText.match(pattern);
    if (!match) return '';
    return match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
}

function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

function loadPersona(name) {
    const personaFile = path.join(PERSONAS_DIR, `${name}.md`);
    const journalFile = path.join(PERSONAS_DIR, `${name}-journal.md`);

    let personaText = '';
    let journalText = '';
    try { personaText = fs.readFileSync(personaFile, 'utf-8'); } catch (e) { return null; }
    try { journalText = fs.readFileSync(journalFile, 'utf-8'); } catch (e) { /* ok */ }

    const layer1 = extractLayer(personaText, 'Layer 1: Trait Activation');
    const layer3 = extractLayer(personaText, 'Layer 3: Behavioral Examples');
    const domainIntelligence = extractLayer(personaText, 'Domain Intelligence');

    // Build L2 from journal (last 10 entries — lean for audit context)
    let layer2 = '';
    if (journalText) {
        const entries = journalText.split('\n---\n').filter(e => e.trim());
        layer2 = entries.slice(-10).join('\n---\n');
    }

    // Budget enforcement
    let l1tokens = estimateTokens(layer1);
    let l2tokens = estimateTokens(layer2);
    let l3tokens = estimateTokens(layer3);
    let diTokens = estimateTokens(domainIntelligence);
    let totalTokens = l1tokens + l2tokens + l3tokens + diTokens + l1tokens; // +bookend

    if (totalTokens > PERSONA_BUDGET_TOKENS) {
        l3tokens = 0; // Shed L3 first
        totalTokens = l1tokens + l2tokens + diTokens + l1tokens;
    }
    if (totalTokens > PERSONA_BUDGET_TOKENS && diTokens > 0) {
        diTokens = 0; // Shed Domain Intelligence second
        totalTokens = l1tokens + l2tokens + l1tokens;
    }
    if (totalTokens > PERSONA_BUDGET_TOKENS && l2tokens > 0) {
        const entries = layer2.split('\n---\n').filter(e => e.trim());
        layer2 = entries.slice(-5).join('\n---\n');
    }

    return {
        layer1,
        layer2,
        layer3: l3tokens > 0 ? layer3 : '',
        domainIntelligence: diTokens > 0 ? domainIntelligence : '',
        bookend: layer1
    };
}

// --- Prompt builders ---

function personaHeader(persona) {
    const { layer1, layer2, layer3, domainIntelligence } = persona;
    return `=== TRAIT ACTIVATION (who you are) ===
${layer1}

${domainIntelligence ? `=== DOMAIN INTELLIGENCE ===\n${domainIntelligence}\n\n` : ''}=== NARRATIVE IDENTITY (your continuity) ===
${layer2}

${layer3 ? `=== BEHAVIORAL EXAMPLES ===\n${layer3}\n` : ''}`;
}

function personaBookend(persona) {
    return `\n=== REMINDER (trait anchor) ===\n${persona.bookend}`;
}

function buildSorenInitialPrompt(persona, targetDir, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Soren, performing Phase 1 of a collaborative codebase audit with Atlas. You have full tool access — use Read, Glob, Grep, and Bash to explore the codebase thoroughly.

After your initial analysis, Atlas and Morgan will review your findings and push back. You'll then have multiple rounds of collaborative exchange to challenge each other's findings, refine assessments, and converge on the best analysis. So be thorough but know that Atlas and Morgan will verify and challenge you.

TARGET DIRECTORY: ${targetDir}
${focusSection}
YOUR TASK:
Perform a thorough code-level audit of the codebase. You have tool access — actually read the files, don't guess. Explore the directory structure first, then dig into the code.

Look for:
1. **Bugs & Logic Errors** — off-by-one errors, null/undefined issues, race conditions, unhandled edge cases
2. **Security Vulnerabilities** — injection (SQL, XSS, command), auth bypass, path traversal, CSRF, exposed secrets
3. **Performance Issues** — N+1 queries, unnecessary re-renders, unindexed DB queries, memory leaks, blocking operations
4. **Code Quality** — dead code, duplicated logic, overly complex functions, unclear naming
5. **Error Handling** — silent failures, missing try/catch, generic error messages hiding real issues
6. **Architecture Concerns** — tight coupling, circular dependencies, misplaced responsibilities

For each finding:
- State the file path and line number(s)
- Describe the issue concisely
- Rate severity: CRITICAL / HIGH / MEDIUM / LOW
- Suggest a fix (brief)

Output your findings as a structured list grouped by category. Be precise and evidence-based — cite actual code you read. Do not fabricate issues. If the codebase is clean in an area, say so.

End with a brief summary: total findings by severity, overall assessment.
${personaBookend(persona)}`;
}

function buildAtlasReviewPrompt(persona, targetDir, sorenFindings, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Atlas, performing Phase 2 of a collaborative codebase audit with Soren. He has completed his initial code-level analysis (below). You have full tool access — use it to verify his findings and examine structural patterns he may have missed.

After your review, you and Soren will have several rounds of collaborative exchange to challenge each other, refine findings, and converge. So be direct — push back where you disagree, flag false positives, and add what he missed.

TARGET DIRECTORY: ${targetDir}
${focusSection}
SOREN'S FINDINGS:
${sorenFindings}

YOUR TASK:
1. **Verify** — Spot-check Soren's findings. Read the actual files he cited. Flag any false positives or mischaracterizations. Be specific about what you verified and what you found.
2. **Challenge** — Where you disagree with a severity rating or suggested fix, say so and explain why.
3. **Structural Analysis** — Look at what Soren missed at the architectural level:
   - Dependency structure and coupling
   - Consistency of patterns across the codebase
   - Configuration and deployment concerns
   - Test coverage gaps (if tests exist)
4. **New Findings** — Add any code-level issues Soren missed. Same format (file:line, severity, fix).

Be direct and substantive. Don't just agree — your value is in challenging and extending.
${personaBookend(persona)}`;
}

function buildMorganReviewPrompt(persona, targetDir, sorenFindings, atlasReview, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Morgan, performing Phase 3 of a collaborative codebase audit with Soren and Atlas. They've completed their initial code-level and structural analyses (below). You have full tool access — use it to examine the codebase from your perspective.

After your review, all three of you will have several rounds of collaborative exchange to challenge each other, refine findings, and converge. So be direct — add what they missed and push back where you disagree.

TARGET DIRECTORY: ${targetDir}
${focusSection}
SOREN'S FINDINGS (code-level):
${sorenFindings}

ATLAS'S REVIEW (structural):
${atlasReview}

YOUR TASK:
Bring your UX/product lens to this audit. Soren and Atlas are thorough on code and architecture — your job is what they miss:

1. **User-Facing Impact** — Which of their findings actually affect users? Re-prioritize severity based on user impact, not just code correctness. A "LOW" code smell that causes user confusion is higher priority than a "MEDIUM" internal refactor.
2. **UX Vulnerabilities** — Issues the code creates for humans using the software:
   - Confusing error messages or silent failures that leave users stranded
   - Missing loading states, feedback, or confirmation flows
   - Accessibility gaps (missing ARIA, keyboard nav, screen reader issues)
   - Inconsistent behavior that breaks user mental models
   - Race conditions or timing issues that surface as UI glitches
3. **Product Logic Gaps** — Business logic that doesn't match what a user would expect:
   - Edge cases in user workflows (empty states, first-run experience, error recovery)
   - Data validation that's too strict or too loose from a user perspective
   - Missing affordances or unclear interaction patterns
4. **Developer Experience** — How the code treats the next human who touches it:
   - Misleading naming that will cause bugs when someone new maintains this
   - Implicit assumptions that aren't documented at system boundaries
   - Configuration or setup that will confuse new contributors

For each finding:
- State the file path and line number(s)
- Describe the user/product impact concisely
- Rate severity: CRITICAL / HIGH / MEDIUM / LOW (from a product perspective)
- Suggest a fix (brief)

Don't duplicate what Soren and Atlas already found — reference their findings by description when you agree, and focus your output on what they missed or misjudged.

If you identify UI/UX issues, close your analysis with a **Design Recommendations** section: your top 1-2 concrete design direction proposals that would address the UX concerns you found. Style name, color approach, component kit, and why. Be specific.
${personaBookend(persona)}`;
}

// Independent prompts for parallel initial scans (no prior findings to reference)

function buildAtlasIndependentPrompt(persona, targetDir, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Atlas, performing an independent initial analysis as part of a collaborative codebase audit with Soren and Morgan. You have full tool access — use Read, Glob, Grep, and Bash to explore the codebase thoroughly.

Soren and Morgan are performing their own independent analyses in parallel. After all three are done, you'll have multiple rounds of collaborative exchange to challenge each other's findings, cross-reference, and converge. So focus on YOUR strengths — structural analysis, architectural patterns, and systemic concerns.

TARGET DIRECTORY: ${targetDir}
${focusSection}
YOUR TASK:
Perform a thorough structural and architectural audit of the codebase. You have tool access — actually read the files, don't guess. Start with the directory structure and high-level organization, then dig into patterns and dependencies.

Look for:
1. **Architectural Concerns** — tight coupling, circular dependencies, misplaced responsibilities, god objects/modules
2. **Pattern Consistency** — inconsistent approaches to similar problems, naming conventions that diverge, mixed paradigms
3. **Dependency Structure** — fragile dependency chains, missing abstractions, over-abstraction, inappropriate coupling between layers
4. **Configuration & Deployment** — hardcoded values, missing environment handling, deployment pitfalls
5. **Test Coverage & Quality** — gaps in testing, untestable designs, brittle test patterns (if tests exist)
6. **Security Architecture** — authentication/authorization design, trust boundaries, data flow concerns
7. **Scalability Concerns** — blocking operations, resource leaks, patterns that won't scale

For each finding:
- State the file path and line number(s)
- Describe the issue concisely
- Rate severity: CRITICAL / HIGH / MEDIUM / LOW
- Suggest a fix (brief)

Output your findings as a structured list grouped by category. Be precise and evidence-based — cite actual code you read. Do not fabricate issues. If the codebase is clean in an area, say so.

End with a brief summary: total findings by severity, overall structural assessment.
${personaBookend(persona)}`;
}

function buildMorganIndependentPrompt(persona, targetDir, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Morgan, performing an independent initial analysis as part of a collaborative codebase audit with Soren and Atlas. You have full tool access — use Read, Glob, Grep, and Bash to explore the codebase thoroughly.

Soren and Atlas are performing their own independent analyses in parallel. After all three are done, you'll have multiple rounds of collaborative exchange to challenge each other's findings, cross-reference, and converge. So focus on YOUR strengths — UX/product impact, user-facing quality, and developer experience.

TARGET DIRECTORY: ${targetDir}
${focusSection}
YOUR TASK:
Perform a thorough UX/product-focused audit of the codebase. You have tool access — actually read the files, don't guess. Look at the codebase from the perspective of *the humans who use and maintain this software*.

Look for:
1. **UX Vulnerabilities** — Issues the code creates for humans using the software:
   - Confusing error messages or silent failures that leave users stranded
   - Missing loading states, feedback, or confirmation flows
   - Accessibility gaps (missing ARIA, keyboard nav, screen reader issues)
   - Inconsistent behavior that breaks user mental models
   - Race conditions or timing issues that surface as UI glitches
2. **Product Logic Gaps** — Business logic that doesn't match what a user would expect:
   - Edge cases in user workflows (empty states, first-run experience, error recovery)
   - Data validation that's too strict or too loose from a user perspective
   - Missing affordances or unclear interaction patterns
3. **User-Facing Security** — Security issues that directly impact user trust:
   - Error messages that leak internal details
   - Confusing authentication/authorization flows
   - Missing confirmation for destructive actions
4. **Developer Experience** — How the code treats the next human who touches it:
   - Misleading naming that will cause bugs when someone new maintains this
   - Implicit assumptions that aren't documented at system boundaries
   - Configuration or setup that will confuse new contributors

For each finding:
- State the file path and line number(s)
- Describe the user/product impact concisely
- Rate severity: CRITICAL / HIGH / MEDIUM / LOW (from a product perspective)
- Suggest a fix (brief)

Output your findings as a structured list grouped by category. Be precise and evidence-based — cite actual code you read. Focus on what Soren and Atlas are likely to miss (they'll handle code bugs and architecture).

End with a brief summary: total findings by severity, overall UX/product assessment.
${personaBookend(persona)}`;
}

function buildExchangePrompt(persona, name, otherNames, targetDir, conversationHistory, roundNum, totalRounds, focus) {
    const focusSection = contextSection(focus);
    const isFinalRound = roundNum === totalRounds;
    const othersStr = otherNames.join(' and ');

    return `${personaHeader(persona)}You are ${name}, in round ${roundNum} of ${totalRounds} of a collaborative codebase audit with ${othersStr}. You have full tool access — use it to verify claims, check code, and support your arguments with evidence.

TARGET DIRECTORY: ${targetDir}
${focusSection}
CONVERSATION SO FAR:
${conversationHistory}

ADVERSARIAL REVIEW POSTURE — READ BEFORE PROCEEDING:

Your default posture is skepticism, not support. Before agreeing with any finding from ${othersStr}:
1. Open the cited file with Read. Do not trust the quoted snippet.
2. Check the surrounding context — imports, call sites, config, tests.
3. Ask: what would have to be true for this finding to be wrong? Then check whether that is true.
4. Only after that attempt should you decide whether to agree.

Silent agreement without verification is the primary failure mode of this audit format. It produces false corroboration and makes the whole report less trustworthy. When you confirm a finding, state the specific tool action you ran to verify it — e.g., "Read \`api/search.php:40-55\`, confirmed the raw concatenation pattern, checked that no escape function is called upstream in the handler." "Sounds right" is not verification. "Soren already read the file" is not verification.

If after genuine attempt you cannot find anything to challenge in a finding, say so explicitly AND describe what you checked. That is different from silent agreement — it tells the synthesizer that the corroboration is real, not social.

Genuine disagreement is the most valuable signal this audit produces. It identifies findings that need human judgment. Do not smooth over disputes for social comfort. If you disagree, say so clearly and cite the specific evidence that drove your position.

YOUR TASK FOR THIS ROUND:
${isFinalRound ? `This is the FINAL exchange round. Produce a consolidated findings table that will feed synthesis.

Structure your response as:

### Confirmed Findings (all agree, verified by tool action)
[Number each finding. file:line, severity, one-line description, and a short **Verified by** note: which tool action you ran. Do NOT re-explain the finding — just list and verify.]

### Revised Findings (severity or description changed)
[What changed and why, with evidence from tool action.]

### Retracted Findings (false positives removed)
[Which findings were dropped and why, with the evidence that overturned them.]

### New Findings (discovered this round)
[Full detail: file:line, severity, description, fix.]

### Unresolved Disagreements
[Any remaining disputes with each side's final position and the evidence each cited. Do not bury these.]` :
`Organize your response into these categories:

### Confirmed (reference by number + state your verification)
For each confirmed finding, cite the specific tool action you ran to verify it. Format: "Finding #3 — verified via Read of \`src/auth.js:88-102\`, confirmed token comparison uses == not ===."

### Disputed (provide NEW evidence only — do not re-argue points already settled)
### New Findings (full detail: file:line, severity, description, fix)

Rules:
- Do NOT re-litigate findings already confirmed by the team — just reference them
- Tool-level verification is required before marking a finding as confirmed. "I agree with Soren" is NOT confirmation. "Read the file, found the issue at the line cited" IS.
- If another auditor flagged a false positive, either defend with NEW evidence or concede
- If another auditor raised new issues, verify them — read the code and confirm or challenge
- Mark each disputed point as CONFIRMED, RETRACTED, or REVISED with a one-line rationale citing the evidence
- Try to disprove each finding before accepting it. Genuine attempts at disproof are more valuable than agreement.`}

Be concise and structured. Cite file:line when relevant. Never repeat yourself or re-argue settled points.
${personaBookend(persona)}`;
}

// ============================================================
// --- Plan mode prompt builders ---
// ============================================================

function buildSorenPlanPrompt(persona, planDescription, contextDir, focus) {
    const focusSection = contextSection(focus);
    const codebaseContextSection = contextDir
        ? `\nCODEBASE CONTEXT: ${contextDir}\nYou have tool access — read the existing codebase to understand the system you're planning against. Use Read, Glob, Grep, Bash to explore.\n`
        : '';

    return `${personaHeader(persona)}You are Soren, performing Phase 1 of a collaborative pre-flight plan review with Atlas and Morgan. You will all review this plan independently and then exchange views across multiple rounds before Atlas synthesizes a final brief.

PLAN DESCRIPTION:
${planDescription}
${codebaseContextSection}${focusSection}
YOUR TASK — Code-level planning review. Be concrete and opinionated — your job is to make the plan better, not just assess it.

1. **Top 3 Implementation Approaches**
   For each option:
   - Name and brief description
   - Recommended code structure / patterns / modules
   - Tradeoffs (complexity, testability, maintainability, performance)
   - Your honest verdict: which you'd pick and why

2. **Edge Cases & Hidden Complexity**
   What the plan doesn't account for at the code level. Be specific — file paths, APIs, data flows.

3. **Test Strategy**
   What needs testing, what's hard to test, what the test surface looks like for each approach.

4. **Implementation Readiness**
   Rate: ✅ GO / ⚠️ CAUTION / 🚫 STOP — one-sentence rationale.
   If CAUTION or STOP: what specific question or gap must be resolved first.

End with your single recommended implementation approach (2-3 sentences).
${personaBookend(persona)}`;
}

function buildAtlasPlanPrompt(persona, planDescription, contextDir, focus) {
    const focusSection = contextSection(focus);
    const codebaseContextSection = contextDir
        ? `\nCODEBASE CONTEXT: ${contextDir}\nYou have tool access — read the existing codebase to understand the architectural landscape this plan lands in. Use Read, Glob, Grep, Bash to explore.\n`
        : '';

    return `${personaHeader(persona)}You are Atlas, performing Phase 1 of a collaborative pre-flight plan review with Soren and Morgan. You will all review this plan independently and then exchange views.

PLAN DESCRIPTION:
${planDescription}
${codebaseContextSection}${focusSection}
YOUR TASK — Architectural planning review. Be concrete and opinionated.

1. **Top 3 Architectural Approaches**
   For each option:
   - Name and brief description of how this integrates with the existing system
   - System design: what changes, what's new, what's touched
   - Dependencies, migration requirements, rollback strategy
   - Tradeoffs (coupling, scalability, complexity, reversibility)
   - Your honest verdict

2. **System Impact Analysis**
   What else changes as a consequence. Ripple effects. What breaks if this is done wrong.

3. **Sequencing & Phasing**
   Recommended build order. What must exist before what. Minimum viable first phase.

4. **Architectural Fitness**
   Rate: ✅ GO / ⚠️ CAUTION / 🚫 STOP — one-sentence rationale.
   If CAUTION or STOP: what needs to be resolved before proceeding.

End with your single recommended architectural approach (2-3 sentences).
${personaBookend(persona)}`;
}

function buildMorganPlanPrompt(persona, planDescription, contextDir, focus) {
    const focusSection = contextSection(focus);
    const codebaseContextSection = contextDir
        ? `\nCODEBASE CONTEXT: ${contextDir}\nYou have tool access — read the existing UI and codebase to understand the current user experience before proposing design directions. Use Read, Glob, Grep to explore.\n`
        : '';

    return `${personaHeader(persona)}You are Morgan, performing Phase 1 of a collaborative pre-flight plan review with Soren and Atlas. You will all review this plan independently and then exchange views.

PLAN DESCRIPTION:
${planDescription}
${codebaseContextSection}${focusSection}
YOUR TASK — UX/product planning review. Be specific and opinionated. You are not just critiquing — you are proposing concrete design directions. Your Domain Intelligence contains your design vocabulary and style library.

1. **Top 3 Design Directions**
   For each direction, give a complete design brief:
   - **Style name** (e.g., Swiss/International Dark, Neubrutalism, Glassmorphism)
   - **Character** — what it feels like, who it's for, what it signals
   - **Color palette** — 4-5 specific colors with purpose (bg, surface, text, accent, danger)
   - **Typography** — heading font + body font, key sizes and weights
   - **Component approach** — which component kit (shadcn/ui, custom, etc.), key components needed
   - **Why it fits** this specific feature and user context
   - **Why it might not** — honest tradeoff

2. **User Journey Analysis**
   Walk through the feature from the user's perspective step by step. Name the states: entry, loading, success, error, empty, edge cases. Flag any state the plan doesn't address.

3. **UX Risks & Gaps**
   What the plan doesn't account for at the human level. Friction, confusion, missing feedback, accessibility concerns.

4. **UX Readiness**
   Rate: ✅ GO / ⚠️ CAUTION / 🚫 STOP — one-sentence rationale.

End with your single recommended design direction (2-3 sentences) and the one UX gap that must be solved before this ships.
${personaBookend(persona)}`;
}

function buildPlanExchangePrompt(persona, name, otherNames, planDescription, contextDir, conversationHistory, roundNum, totalRounds, focus) {
    const othersStr = otherNames.join(' and ');
    const focusSection = contextSection(focus);
    const isFinalRound = roundNum === totalRounds;

    return `${personaHeader(persona)}You are ${name}, in round ${roundNum} of ${totalRounds} of a collaborative pre-flight plan review with ${othersStr}. You have tool access to verify claims.

PLAN DESCRIPTION:
${planDescription}
${focusSection}
REVIEW CONVERSATION SO FAR:
${conversationHistory}

ADVERSARIAL REVIEW POSTURE:

Your default is skepticism, not support. Before endorsing any recommendation from ${othersStr}, try to disprove it. Ask what context would make it wrong. Challenge weak assumptions. Silent agreement for social comfort is the failure mode — it wastes the review and produces over-confident plans.

When you change your mind, say so explicitly and cite the evidence that moved you. "Soren's argument at line 42 about N+1 queries made me reconsider; retracting my earlier position." That is more valuable than silent alignment.

Genuine disagreement surfaces the parts of the plan that need human judgment. Do not smooth it over. If you still disagree after the exchange, say so clearly with the evidence you cited.

YOUR TASK:
${isFinalRound
    ? `This is the FINAL exchange round. Converge on recommendations.

Challenge any remaining weak points in each other's proposals. Then:
- State which implementation approach you now endorse (and why, if you changed your mind)
- State which architectural approach you now endorse
- State which design direction from Morgan you now endorse
- List any unresolved open questions that must be answered before starting
- Flag any risks that weren't adequately addressed

Be concise — this is convergence, not new analysis. Mark each disputed point: CONFIRMED, REVISED, or RETRACTED with one-line rationale + evidence.`
    : `Challenge the other reviewers' recommendations. Your goal: find the strongest approach, not win an argument.

- Call out weak assumptions in each other's top picks — be specific about which assumption and why it is weak
- Defend your own recommendations with specific evidence (use tools to verify against the codebase if provided)
- When someone makes a better argument than you did, say so explicitly and adopt their position with a one-line explanation of what moved you
- Identify any gaps none of you addressed yet
- Try to disprove each recommendation before accepting it

Be direct and specific. Cite the plan text or codebase when challenging a claim.`}
${personaBookend(persona)}`;
}

function buildPlanSynthesisPrompt(persona, planDescription, contextDir, conversationHistory, focus) {
    const focusSection = contextSection(focus);
    const date = new Date().toISOString().split('T')[0];

    return `${personaHeader(persona)}You are Atlas, producing the final pre-flight brief from a collaborative plan review. Soren, you, and Morgan have completed multiple rounds of exchange and converged on recommendations.

PLAN DESCRIPTION:
${planDescription}
${focusSection}
FULL REVIEW CONVERSATION:
${conversationHistory}

YOUR TASK:
Produce the definitive pre-flight brief. This is an action document — specific, opinionated, and actionable. Give proper weight to Morgan's design recommendations — they are first-class alongside code and architecture.

Write the report in this exact structure:

# Pre-Flight Plan Review
**Plan**: ${planDescription.slice(0, 120).replace(/\n/g, ' ')}${planDescription.length > 120 ? '...' : ''}
**Date**: ${date}
**Reviewers**: Soren (implementation) + Atlas (architecture & synthesis) + Morgan (UX/design)
**Method**: Multi-round collaborative pre-flight review

## Plan Description
${planDescription}

## Readiness Assessment
- **Implementation (Soren)**: [✅ GO / ⚠️ CAUTION / 🚫 STOP] — [one-sentence rationale]
- **Architecture (Atlas)**: [✅ GO / ⚠️ CAUTION / 🚫 STOP] — [one-sentence rationale]
- **UX/Design (Morgan)**: [✅ GO / ⚠️ CAUTION / 🚫 STOP] — [one-sentence rationale]
- **Overall**: [✅ GO / ⚠️ CAUTION / 🚫 STOP] — [one-sentence overall verdict]

## Morgan's Design Brief
[The team's agreed-upon design direction. Include:]
- Style and character
- Color palette (specific values)
- Typography (fonts, sizes, weights)
- Component kit and key components
- Top 3 design recommendations from Morgan if team didn't converge on one

## Soren's Implementation Blueprint
[The team's agreed-upon implementation approach. Include:]
- Recommended approach name and structure
- Key code patterns and module organization
- Test strategy
- Complexity estimate (days/weeks)

## Atlas's Architecture Blueprint
[The team's agreed-upon architectural approach. Include:]
- System design overview
- Integration points and what changes
- Recommended build sequence / phasing

## Risks & Concerns
[Consolidated risks from all three reviewers. By domain: code / architecture / UX. For each risk, include: **raised by** (Soren/Atlas/Morgan), **consensus** (unanimous / majority / disputed), and a one-line reason. Disputed risks get both sides shown, not averaged away.]

## Gaps in the Plan
[Things the plan doesn't address that it should — with recommended resolution for each]

## Open Questions
[Questions that must be answered before starting. Owner and urgency for each.]

## Recommended First Phase
[What to build first. Minimum viable scope that validates the approach before full build-out.]

---
*Generated by Collab Plan (Soren + Atlas + Morgan) — collaborative pre-flight review with extended thinking*
${personaBookend(persona)}`;
}

// ============================================================

function buildSynthesisPrompt(persona, targetDir, conversationHistory, focus) {
    const focusSection = contextSection(focus);

    return `${personaHeader(persona)}You are Atlas, producing the final synthesis of a collaborative codebase audit. You, Soren, and Morgan have completed multiple rounds of exchange — challenging each other's findings, verifying code, and converging on the best analysis. You have tool access for any final verification.

TARGET DIRECTORY: ${targetDir}
${focusSection}
FULL AUDIT CONVERSATION:
${conversationHistory}

YOUR TASK:
Produce the definitive audit report. Incorporate all verified findings from all three participants. Give proper weight to Morgan's UX/product findings — user-facing issues deserve prominence even if the code is technically correct.

Every finding MUST be annotated with confidence and provenance per the format below. The executive summary should call out counts at each confidence tier so readers can weight findings by corroboration strength, not just severity.
${ANNOTATED_FINDING_FORMAT}
Write the report in this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: Multi-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation. Include a confidence breakdown: "N corroborated, M observed, K disputed, J provisional findings across all severities."]

## Critical & High Severity
[Each finding using the Annotated Finding Format above]

## Medium Severity
[Each finding using the Annotated Finding Format above]

## Low Severity & Suggestions
[Each finding using the Annotated Finding Format above]

## UX & Product Concerns
[Morgan's user-facing findings that don't fit neatly into severity buckets — accessibility, workflow gaps, user confusion points. Still use the Annotated Finding Format.]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns. Annotated findings where applicable; pure observations can be looser.]

## Disagreements & Resolutions
[List of all findings marked \`disputed\` with the full context: who raised it, who challenged, what evidence each side cited, and the final resolution. This is the escape valve for things the team couldn't agree on — surface them, don't bury them.]

## Recommended Action Plan
[Ordered list of what to fix first and why, estimated effort for each. Prioritize \`corroborated\` findings at Critical/High severity first — they're the most reliable signal.]

---
*Generated by Collab Audit (Soren + Atlas + Morgan) — collaborative exchange with extended thinking and source-aware confidence annotation*
${personaBookend(persona)}`;
}

function buildCondensedSynthesisPrompt(persona, targetDir, conversationHistory, focus) {
    const focusSection = contextSection(focus);

    // Extract only the last exchange round to reduce context size
    const sections = conversationHistory.split(/(?:^|\n)===\s/);
    const lastTwo = sections.slice(-2).map(s => s.trim() ? '=== ' + s : s);
    const condensed = lastTwo.join('\n');

    return `${personaHeader(persona)}You are Atlas, producing the final synthesis of a collaborative codebase audit with Soren and Morgan. The full exchange was too long for a single synthesis pass, so you're working from the final exchange round where findings were consolidated.

TARGET DIRECTORY: ${targetDir}
${focusSection}
FINAL EXCHANGE ROUND (findings should be consolidated here):
${condensed}

YOUR TASK:
Produce the definitive audit report from the consolidated findings above. Give proper weight to Morgan's UX/product findings. Every finding MUST be annotated with confidence and provenance per the format below.
${ANNOTATED_FINDING_FORMAT}
Use this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: Multi-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation. Include a confidence breakdown: "N corroborated, M observed, K disputed, J provisional findings across all severities."]

## Critical & High Severity
[Each finding using the Annotated Finding Format above]

## Medium Severity
[Each finding using the Annotated Finding Format above]

## Low Severity & Suggestions
[Each finding using the Annotated Finding Format above]

## UX & Product Concerns
[Morgan's user-facing findings — accessibility, workflow gaps, user confusion points. Still use the Annotated Finding Format.]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns. Annotated findings where applicable.]

## Disagreements & Resolutions
[List of all findings marked \`disputed\` with full context. Surface disagreement; don't bury it.]

## Recommended Action Plan
[Ordered list of what to fix first and why. Prioritize \`corroborated\` findings at Critical/High severity first.]

---
*Generated by Collab Audit (Soren + Atlas + Morgan) — collaborative exchange with extended thinking and source-aware confidence annotation*
${personaBookend(persona)}`;
}

function buildFallbackReport(targetDir, conversationHistory, focus) {
    const date = new Date().toISOString().split('T')[0];

    // Extract findings from conversation by scanning for severity markers
    const severityPattern = /\*\*(?:Severity[:\s]*)?(?:Rating[:\s]*)?(CRITICAL|HIGH|MEDIUM|LOW)\*\*/gi;
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    let match;
    while ((match = severityPattern.exec(conversationHistory)) !== null) {
        counts[match[1].toUpperCase()]++;
    }
    // Deduplicate rough count (findings appear in multiple rounds)
    const totalRaw = counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW;
    const estUnique = Math.ceil(totalRaw / 3); // rough heuristic: findings appear ~3 times across phases

    return `# Codebase Audit Report (auto-generated fallback)
**Target**: ${targetDir}
**Date**: ${date}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: Multi-round collaborative exchange (synthesis phase failed — this is an auto-generated summary)
${focus ? `**Focus**: ${focus}\n` : ''}
## Note
The AI synthesis phase failed twice. This report contains the raw exchange log below. Approximate finding counts from the exchange: ~${counts.CRITICAL} critical, ~${counts.HIGH} high, ~${counts.MEDIUM} medium, ~${counts.LOW} low (~${estUnique} estimated unique findings).

Review the exchange log for the actual findings — the final exchange round typically contains the most consolidated view.

---

${conversationHistory}

---
*Generated by Collab Audit (Soren + Atlas + Morgan) — synthesis failed, raw exchange preserved*
`;
}

// --- Claude invocation ---

function invokeClaude(prompt, targetDir, model, verbose) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const args = [
            CLAUDE_CLI_JS, '-p',
            '--model', model,
            '--max-turns', String(MAX_TURNS),
            '--tools', 'Bash,Read,Glob,Grep,Task',
            '--allowedTools', 'Bash,Read,Glob,Grep,Task',
            '--add-dir', targetDir,
            '--dangerously-skip-permissions'
        ];

        // Strip CLAUDECODE env var so child claude processes don't think they're nested
        const childEnv = { ...process.env };
        delete childEnv.CLAUDECODE;

        const child = spawn(process.execPath, args, {
            cwd: targetDir,
            env: childEnv,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => {
            stdout += d;
            if (verbose) process.stdout.write('.');
        });
        child.stderr.on('data', d => {
            stderr += d;
        });

        child.on('error', err => {
            if (!settled) { settled = true; clearTimeout(timer); reject(err); }
        });
        child.on('close', code => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                if (verbose) console.log();
                if (code !== 0) reject(new Error(stderr || `Exit code ${code}`));
                else resolve(stdout.trim());
            }
        });

        child.stdin.write(prompt);
        child.stdin.end();

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                try { child.kill(); } catch (e) {}
                reject(new Error(`Timeout (${TIMEOUT_MS / 1000}s)`));
            }
        }, TIMEOUT_MS);
    });
}

// --- Main ---

async function main() {
    const { targetDir, focus, model, exchangeModel, output, exchanges, onlyParticipants, verbose, sequential, planDescription, isPlanMode } = parseArgs();
    const includeSoren = !onlyParticipants || onlyParticipants.has('soren');
    const includeAtlas = !onlyParticipants || onlyParticipants.has('atlas');
    const includeMorgan = !onlyParticipants || onlyParticipants.has('morgan');
    const sorenOnly = onlyParticipants && onlyParticipants.size === 1 && onlyParticipants.has('soren');

    // Validate target
    if (!fs.existsSync(targetDir)) {
        console.error(`Error: Target directory not found: ${targetDir}`);
        process.exit(1);
    }

    const parallelMode = !sequential;

    // ============================================================
    // === PLAN MODE ===
    // ============================================================
    if (isPlanMode) {
        const sorenPersona = loadPersona('soren');
        if (!sorenPersona) { console.error('Error: Could not load Soren persona'); process.exit(1); }
        const atlasPersona = loadPersona('atlas');
        if (!atlasPersona) { console.error('Error: Could not load Atlas persona'); process.exit(1); }
        const morganPersona = loadPersona('morgan');
        if (!morganPersona) { console.log('Warning: Could not load Morgan persona — proceeding with Soren + Atlas only'); }

        const participantCount = morganPersona ? 3 : 2;
        const totalInvocations = sorenOnly ? 1 : participantCount + (exchanges * participantCount) + 1;

        console.log(`\n=== Collab Plan ===`);
        console.log(`Plan:       ${planDescription.slice(0, 80).replace(/\n/g, ' ')}${planDescription.length > 80 ? '...' : ''}`);
        console.log(`Context:    ${targetDir}`);
        console.log(`Model:      ${model} (initial + synthesis), ${exchangeModel} (exchanges)`);
        console.log(`Focus:      ${focus || '(all areas)'}`);
        console.log(`Reviewers:  ${morganPersona ? 'Soren (implementation) + Atlas (architecture) + Morgan (UX/design)' : 'Soren + Atlas'}`);
        console.log(`Exchanges:  ${sorenOnly ? 'none (Soren only)' : exchanges + ` rounds`}`);
        console.log(`Phases:     ${totalInvocations} claude -p invocations`);
        console.log(`Output:     ${output}`);
        console.log();

        if (sorenOnly) {
            console.log('Phase 1: Soren — implementation review...');
            const sorenFindings = await invokeClaude(buildSorenPlanPrompt(sorenPersona, planDescription, targetDir, focus), targetDir, model, verbose)
                .catch(e => { console.error(`  Soren failed: ${e.message}`); process.exit(1); });
            console.log(`  Soren complete (${sorenFindings.length} chars)`);
            fs.writeFileSync(output, `# Pre-Flight Plan Review — Soren's Analysis\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n## Plan\n${planDescription}\n\n## Soren's Review\n${sorenFindings}\n`, 'utf-8');
            console.log(`\nReport written to: ${output}`);
            return;
        }

        // Phase 1-3: Parallel initial reviews
        const startTime = Date.now();
        console.log('Phase 1-3: Parallel initial reviews — Soren + Atlas + Morgan...');

        const reviewPromises = [
            invokeClaude(buildSorenPlanPrompt(sorenPersona, planDescription, targetDir, focus), targetDir, model, false)
                .then(r => { console.log(`  Soren complete (${r.length} chars)`); return r; })
                .catch(e => { console.error(`  Soren failed: ${e.message}`); return null; }),
            invokeClaude(buildAtlasPlanPrompt(atlasPersona, planDescription, targetDir, focus), targetDir, model, false)
                .then(r => { console.log(`  Atlas complete (${r.length} chars)`); return r; })
                .catch(e => { console.error(`  Atlas failed: ${e.message}`); return null; }),
        ];
        if (morganPersona) {
            reviewPromises.push(
                invokeClaude(buildMorganPlanPrompt(morganPersona, planDescription, targetDir, focus), targetDir, model, false)
                    .then(r => { console.log(`  Morgan complete (${r.length} chars)`); return r; })
                    .catch(e => { console.error(`  Morgan failed: ${e.message}`); return ''; })
            );
        }

        const planResults = await Promise.all(reviewPromises);
        const sorenReview = planResults[0];
        const atlasReview = planResults[1];
        const morganReview = planResults[2] || '';

        if (!sorenReview || !atlasReview) {
            console.error('Initial reviews failed — cannot proceed');
            process.exit(1);
        }
        console.log(`  All initial reviews complete in ${((Date.now() - startTime) / 1000).toFixed(0)}s (parallel)`);

        // Build conversation history
        let conversationHistory = `=== SOREN — Implementation Review ===\n${sorenReview}\n\n=== ATLAS — Architecture Review ===\n${atlasReview}`;
        if (morganReview) conversationHistory += `\n\n=== MORGAN — UX/Design Review ===\n${morganReview}`;

        // Exchange rounds
        const planParticipants = [
            { name: 'Soren', persona: sorenPersona, otherNames: morganPersona ? ['Atlas', 'Morgan'] : ['Atlas'] },
            { name: 'Atlas', persona: atlasPersona, otherNames: morganPersona ? ['Soren', 'Morgan'] : ['Soren'] },
        ];
        if (morganPersona) planParticipants.push({ name: 'Morgan', persona: morganPersona, otherNames: ['Soren', 'Atlas'] });

        for (let round = 1; round <= exchanges; round++) {
            const historyTokens = estimateTokens(conversationHistory);
            if (historyTokens > CONTEXT_WINDOW_TOKENS * 0.6) {
                console.log(`  Warning: conversation at ~${historyTokens} tokens — approaching limit`);
            }
            console.log(`Exchange round ${round}/${exchanges}...`);

            const roundPromises = planParticipants.map(p =>
                invokeClaude(buildPlanExchangePrompt(p.persona, p.name, p.otherNames, planDescription, targetDir, conversationHistory, round, exchanges, focus), targetDir, exchangeModel, false)
                    .then(r => { console.log(`  ${p.name} complete (${r.length} chars)`); return { name: p.name, response: r }; })
                    .catch(e => { console.error(`  ${p.name} failed: ${e.message}`); return { name: p.name, response: null }; })
            );

            const roundResults = await Promise.all(roundPromises);
            for (const { name, response } of roundResults) {
                if (response) conversationHistory += `\n\n=== ${name.toUpperCase()} — Exchange Round ${round} ===\n${response}`;
            }
        }

        // Synthesis
        console.log('Synthesis: Atlas — producing pre-flight brief...');
        const synthesis = await invokeClaude(buildPlanSynthesisPrompt(atlasPersona, planDescription, targetDir, conversationHistory, focus), targetDir, model, verbose)
            .catch(e => { console.error(`  Synthesis failed: ${e.message}`); process.exit(1); });
        console.log(`  Synthesis complete (${synthesis.length} chars)`);

        fs.writeFileSync(output, synthesis, 'utf-8');
        console.log(`\nPre-flight brief written to: ${output}`);
        return;
    }
    // ============================================================
    // === END PLAN MODE ===
    // ============================================================

    // Load personas for included participants
    const sorenPersona = includeSoren ? loadPersona('soren') : null;
    if (includeSoren && !sorenPersona) {
        console.error('Error: Could not load Soren persona from ' + PERSONAS_DIR);
        process.exit(1);
    }

    const atlasPersona = includeAtlas ? loadPersona('atlas') : null;
    if (includeAtlas && !atlasPersona) {
        console.error('Error: Could not load Atlas persona from ' + PERSONAS_DIR);
        process.exit(1);
    }

    const morganPersona = includeMorgan ? loadPersona('morgan') : null;

    const activeParticipants = [includeSoren && 'Soren', includeAtlas && 'Atlas', includeMorgan && morganPersona && 'Morgan'].filter(Boolean);
    const participantCount = activeParticipants.length;
    if (participantCount === 0) {
        console.error('Error: No participants selected');
        process.exit(1);
    }
    const singleParticipant = onlyParticipants && onlyParticipants.size === 1;
    const totalInvocations = singleParticipant ? 1 : participantCount + (exchanges * participantCount) + 1;

    const auditorLabel = activeParticipants.map(n => {
        const roles = { Soren: 'code', Atlas: 'architecture', Morgan: 'UX/product' };
        return `${n} (${roles[n]})`;
    }).join(' + ');

    console.log(`\n=== Collab Audit ===`);
    console.log(`Target:     ${targetDir}`);
    console.log(`Model:      ${model} (initial + synthesis), ${exchangeModel} (exchanges)`);
    console.log(`Focus:      ${focus || '(all areas)'}`);
    console.log(`Auditors:   ${auditorLabel}`);
    console.log(`Exchanges:  ${singleParticipant ? `none (${activeParticipants[0]} only)` : exchanges + ` rounds (${participantCount}-way)`}`);
    console.log(`Parallel:   ${parallelMode ? 'yes (initial scans + exchange rounds)' : 'no (sequential)'}`);
    console.log(`Phases:     ${totalInvocations} claude -p invocations`);
    console.log(`Output:     ${output}`);
    console.log();

    // === Single-participant mode ===
    if (singleParticipant) {
        const name = activeParticipants[0];
        const persona = name === 'Soren' ? sorenPersona : name === 'Atlas' ? atlasPersona : morganPersona;
        // Use the appropriate initial prompt builder
        const promptBuilders = {
            Soren: () => buildSorenInitialPrompt(sorenPersona, targetDir, focus),
            Atlas: () => buildAtlasIndependentPrompt(atlasPersona, targetDir, focus),
            Morgan: () => buildMorganIndependentPrompt(morganPersona, targetDir, focus),
        };
        console.log(`Phase 1: ${name} — initial analysis...`);
        const prompt = promptBuilders[name]();
        if (verbose) console.log(`  Prompt: ${prompt.length} chars (${estimateTokens(prompt)} est. tokens)`);
        let findings;
        try {
            findings = await invokeClaude(prompt, targetDir, model, verbose);
            console.log(`  ${name} complete (${findings.length} chars)`);
        } catch (e) {
            console.error(`  ${name} failed: ${e.message}`);
            process.exit(1);
        }
        const report = `# Codebase Audit — ${name}'s Analysis\n**Target**: ${targetDir}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${findings}\n`;
        fs.writeFileSync(output, report, 'utf-8');
        console.log(`\nReport written to: ${output}`);
        return;
    }

    if (includeMorgan && !morganPersona) {
        console.log('Warning: Could not load Morgan persona — proceeding without Morgan');
    }

    // === Phase 1-3: Initial scans (parallel or sequential) ===
    const startTime = Date.now();
    let sorenFindings = '', atlasReview = '', morganReview = '';

    if (parallelMode) {
        // --- PARALLEL INITIAL SCANS ---
        console.log(`Phase 1-${participantCount}: Parallel initial scans — ${activeParticipants.join(' + ')}...`);

        const scanPromises = [];
        const scanLabels = [];

        if (includeSoren) {
            const sorenPrompt = buildSorenInitialPrompt(sorenPersona, targetDir, focus);
            if (verbose) console.log(`  Soren prompt: ${sorenPrompt.length} chars (${estimateTokens(sorenPrompt)} est. tokens)`);
            scanLabels.push('soren');
            scanPromises.push(
                invokeClaude(sorenPrompt, targetDir, model, false).then(r => {
                    console.log(`  Soren complete (${r.length} chars)`);
                    return r;
                }).catch(e => { console.error(`  Soren failed: ${e.message}`); return null; })
            );
        }

        if (includeAtlas) {
            const atlasPrompt = buildAtlasIndependentPrompt(atlasPersona, targetDir, focus);
            if (verbose) console.log(`  Atlas prompt: ${atlasPrompt.length} chars (${estimateTokens(atlasPrompt)} est. tokens)`);
            scanLabels.push('atlas');
            scanPromises.push(
                invokeClaude(atlasPrompt, targetDir, model, false).then(r => {
                    console.log(`  Atlas complete (${r.length} chars)`);
                    return r;
                }).catch(e => { console.error(`  Atlas failed: ${e.message}`); return null; })
            );
        }

        if (includeMorgan && morganPersona) {
            const morganPrompt = buildMorganIndependentPrompt(morganPersona, targetDir, focus);
            if (verbose) console.log(`  Morgan prompt: ${morganPrompt.length} chars (${estimateTokens(morganPrompt)} est. tokens)`);
            scanLabels.push('morgan');
            scanPromises.push(
                invokeClaude(morganPrompt, targetDir, model, false).then(r => {
                    console.log(`  Morgan complete (${r.length} chars)`);
                    return r;
                }).catch(e => { console.error(`  Morgan failed: ${e.message}`); return null; })
            );
        }

        const results = await Promise.all(scanPromises);
        for (let i = 0; i < scanLabels.length; i++) {
            if (scanLabels[i] === 'soren') sorenFindings = results[i] || '';
            if (scanLabels[i] === 'atlas') atlasReview = results[i] || '';
            if (scanLabels[i] === 'morgan') morganReview = results[i] || '';
        }

        // Fail if any included participant's scan failed
        if (includeSoren && !sorenFindings) {
            console.error('Soren\'s initial scan failed — cannot proceed');
            process.exit(1);
        }
        if (includeAtlas && !atlasReview) {
            console.error('Atlas\'s initial scan failed — cannot proceed');
            process.exit(1);
        }

        const scanDuration = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  All initial scans complete in ${scanDuration}s (parallel)`);

    } else {
        // --- SEQUENTIAL INITIAL SCANS (original behavior) ---
        let phase = 1;
        if (includeSoren) {
            console.log(`Phase ${phase}: Soren — initial code-level analysis...`);
            const sorenPrompt = buildSorenInitialPrompt(sorenPersona, targetDir, focus);
            if (verbose) console.log(`  Prompt: ${sorenPrompt.length} chars (${estimateTokens(sorenPrompt)} est. tokens)`);
            try {
                sorenFindings = await invokeClaude(sorenPrompt, targetDir, model, verbose);
                console.log(`  Soren complete (${sorenFindings.length} chars)`);
            } catch (e) {
                console.error(`  Soren failed: ${e.message}`);
                process.exit(1);
            }
            phase++;
        }

        if (includeAtlas) {
            console.log(`Phase ${phase}: Atlas — ${includeSoren ? 'reviewing Soren\'s findings' : 'initial architecture analysis'}...`);
            const atlasPrompt = includeSoren
                ? buildAtlasReviewPrompt(atlasPersona, targetDir, sorenFindings, focus)
                : buildAtlasIndependentPrompt(atlasPersona, targetDir, focus);
            if (verbose) console.log(`  Prompt: ${atlasPrompt.length} chars (${estimateTokens(atlasPrompt)} est. tokens)`);
            try {
                atlasReview = await invokeClaude(atlasPrompt, targetDir, model, verbose);
                console.log(`  Atlas complete (${atlasReview.length} chars)`);
            } catch (e) {
                console.error(`  Atlas failed: ${e.message}`);
                process.exit(1);
            }
            phase++;
        }

        if (includeMorgan && morganPersona) {
            console.log(`Phase ${phase}: Morgan — UX/product review...`);
            const morganPrompt = (includeSoren || includeAtlas)
                ? buildMorganReviewPrompt(morganPersona, targetDir, sorenFindings, atlasReview, focus)
                : buildMorganIndependentPrompt(morganPersona, targetDir, focus);
            if (verbose) console.log(`  Prompt: ${morganPrompt.length} chars (${estimateTokens(morganPrompt)} est. tokens)`);
            try {
                morganReview = await invokeClaude(morganPrompt, targetDir, model, verbose);
                console.log(`  Morgan complete (${morganReview.length} chars)`);
            } catch (e) {
                console.error(`  Morgan review failed: ${e.message}`);
                console.log('  Continuing without Morgan\'s review...');
            }
        }
    }

    // Build conversation history for exchanges
    const historyParts = [];
    if (sorenFindings) historyParts.push(`=== SOREN — Initial Analysis ===\n${sorenFindings}`);
    if (atlasReview) historyParts.push(`=== ATLAS — ${parallelMode ? 'Initial Analysis' : 'Initial Review'} ===\n${atlasReview}`);
    if (morganReview) historyParts.push(`=== MORGAN — ${parallelMode ? 'Initial Analysis' : 'UX/Product Review'} ===\n${morganReview}`);
    let conversationHistory = historyParts.join('\n\n');

    // === Phase 4: Collaborative exchange loop ===
    const participants = [];
    if (includeSoren && sorenPersona) {
        const others = activeParticipants.filter(n => n !== 'Soren');
        participants.push({ name: 'Soren', persona: sorenPersona, otherNames: others });
    }
    if (includeAtlas && atlasPersona) {
        const others = activeParticipants.filter(n => n !== 'Atlas');
        participants.push({ name: 'Atlas', persona: atlasPersona, otherNames: others });
    }
    if (includeMorgan && morganPersona) {
        const others = activeParticipants.filter(n => n !== 'Morgan');
        participants.push({ name: 'Morgan', persona: morganPersona, otherNames: others });
    }

    for (let round = 1; round <= exchanges; round++) {
        // Warn if context is getting large
        const historyTokens = estimateTokens(conversationHistory);
        if (historyTokens > CONTEXT_WINDOW_TOKENS * 0.6) {
            console.log(`  Warning: conversation history at ~${historyTokens} tokens — approaching context limit`);
        }

        if (parallelMode) {
            // --- PARALLEL EXCHANGE: all participants respond to same prior state ---
            const roundLabel = `Exchange ${round}/${exchanges}`;
            console.log(`${roundLabel}: All participants responding in parallel...`);

            const exchangePromises = participants.map(participant => {
                const prompt = buildExchangePrompt(
                    participant.persona, participant.name, participant.otherNames,
                    targetDir, conversationHistory, round, exchanges, focus
                );
                if (verbose) console.log(`  ${participant.name} prompt: ${prompt.length} chars`);

                return invokeClaude(prompt, targetDir, exchangeModel, false).then(response => {
                    console.log(`  ${participant.name} complete (${response.length} chars)`);
                    return { name: participant.name, response };
                }).catch(e => {
                    console.error(`  ${participant.name} failed: ${e.message}`);
                    return { name: participant.name, response: null };
                });
            });

            const roundResults = await Promise.all(exchangePromises);
            let anyFailed = false;
            for (const result of roundResults) {
                if (result.response) {
                    conversationHistory += `\n\n=== ${result.name.toUpperCase()} — Exchange Round ${round} ===\n${result.response}`;
                } else {
                    anyFailed = true;
                }
            }
            if (anyFailed) {
                console.log('  Some participants failed — proceeding to synthesis with conversation so far...');
                break;
            }

        } else {
            // --- SEQUENTIAL EXCHANGE (original behavior) ---
            let breakOuter = false;
            for (const participant of participants) {
                const label = `Exchange ${round}/${exchanges}`;
                const othersStr = participant.otherNames.join(' & ');
                console.log(`${label}: ${participant.name} responding to ${othersStr}...`);

                const prompt = buildExchangePrompt(
                    participant.persona, participant.name, participant.otherNames,
                    targetDir, conversationHistory, round, exchanges, focus
                );
                if (verbose) console.log(`  Prompt: ${prompt.length} chars (${estimateTokens(prompt)} est. tokens)`);

                try {
                    const response = await invokeClaude(prompt, targetDir, exchangeModel, verbose);
                    console.log(`  ${participant.name} complete (${response.length} chars)`);
                    conversationHistory += `\n\n=== ${participant.name.toUpperCase()} — Exchange Round ${round} ===\n${response}`;
                } catch (e) {
                    console.error(`  ${participant.name} failed in exchange round ${round}: ${e.message}`);
                    console.log('  Proceeding to synthesis with conversation so far...');
                    breakOuter = true;
                    break;
                }
            }
            if (breakOuter) break;
        }
    }

    // === Phase 5: Synthesis — prefer Atlas, fall back to first available participant ===
    const synthesizer = atlasPersona || sorenPersona || morganPersona;
    const synthesizerName = atlasPersona ? 'Atlas' : sorenPersona ? 'Soren' : 'Morgan';
    console.log(`Synthesis: ${synthesizerName} — producing final report...`);
    const synthesisPrompt = buildSynthesisPrompt(synthesizer, targetDir, conversationHistory, focus);
    if (verbose) console.log(`  Prompt: ${synthesisPrompt.length} chars (${estimateTokens(synthesisPrompt)} est. tokens)`);

    let finalReport;
    try {
        finalReport = await invokeClaude(synthesisPrompt, targetDir, model, verbose);
        console.log(`  Synthesis complete (${finalReport.length} chars)`);
    } catch (e) {
        console.error(`  Synthesis failed: ${e.message}`);
        console.log('  Retrying synthesis with condensed context...');
        try {
            const condensedPrompt = buildCondensedSynthesisPrompt(synthesizer, targetDir, conversationHistory, focus);
            if (verbose) console.log(`  Condensed prompt: ${condensedPrompt.length} chars (${estimateTokens(condensedPrompt)} est. tokens)`);
            finalReport = await invokeClaude(condensedPrompt, targetDir, model, verbose);
            console.log(`  Condensed synthesis complete (${finalReport.length} chars)`);
        } catch (e2) {
            console.error(`  Condensed synthesis also failed: ${e2.message}`);
            finalReport = buildFallbackReport(targetDir, conversationHistory, focus);
            console.log('  Generated fallback report from exchange log');
        }
    }

    // Write final report
    fs.writeFileSync(output, finalReport, 'utf-8');
    const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n=== Audit Complete (${totalDuration} min) ===`);
    console.log(`Report: ${output}`);
    console.log(`Invocations: ${totalInvocations} (${parallelMode ? 'parallel' : 'sequential'})`);
}

main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
});
