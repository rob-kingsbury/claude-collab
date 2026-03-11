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

const CLAUDE_CLI_JS = 'C:\\Users\\roban\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
const PERSONAS_DIR = 'C:\\claude-collab\\personas';
const DEFAULT_MODEL = 'opus';
const DEFAULT_EXCHANGE_MODEL = 'sonnet'; // Exchange rounds use faster model by default
const MAX_TURNS = 25;
const TIMEOUT_MS = 600000; // 10 minutes per invocation
const DEFAULT_EXCHANGES = 2; // Number of collaborative back-and-forth rounds
const CONTEXT_WINDOW_TOKENS = 200000;
const PERSONA_BUDGET_RATIO = 0.15; // Slightly lower than chatroom — leave room for codebase
const PERSONA_BUDGET_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * PERSONA_BUDGET_RATIO);

// --- Argument parsing ---

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
Collab Audit — Collaborative codebase analysis with Soren, Atlas & Morgan

Usage:
  node audit.js <target-directory> [options]

Options:
  --focus "areas"        Comma-separated focus areas (e.g., "security,performance,ux")
  --exchanges N          Number of exchange rounds (default: ${DEFAULT_EXCHANGES}, range: 1-6)
  --model <model>        Model for initial scans + synthesis (default: opus)
  --exchange-model <m>   Model for exchange rounds (default: sonnet). Use "opus" for max depth
  --output <path>        Output file path (default: <target>/audit-report.md)
  --sequential           Disable parallel execution (run all phases sequentially)
  --soren-only           Run only Soren's pass (skip collaboration)
  --verbose              Show real-time progress
  --help, -h             Show this help

Examples:
  node audit.js c:\\xampp\\htdocs\\ai-ta
  node audit.js c:\\xampp\\htdocs\\bandpilot --focus "security,sql-injection,xss"
  node audit.js . --exchange-model opus --exchanges 3
  node audit.js . --output c:\\audits\\myproject-audit.md
`);
        process.exit(0);
    }

    let targetDir = path.resolve(args[0]);
    let focus = '';
    let model = DEFAULT_MODEL;
    let exchangeModel = DEFAULT_EXCHANGE_MODEL;
    let output = '';
    let exchanges = DEFAULT_EXCHANGES;
    let sorenOnly = false;
    let verbose = false;
    let sequential = false;

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--focus': focus = args[++i] || ''; break;
            case '--exchanges': exchanges = Math.min(6, Math.max(1, parseInt(args[++i]) || DEFAULT_EXCHANGES)); break;
            case '--model': model = args[++i] || DEFAULT_MODEL; break;
            case '--exchange-model': exchangeModel = args[++i] || DEFAULT_EXCHANGE_MODEL; break;
            case '--output': output = args[++i] || ''; break;
            case '--soren-only': sorenOnly = true; break;
            case '--sequential': sequential = true; break;
            case '--verbose': verbose = true; break;
        }
    }

    if (!output) {
        output = path.join(targetDir, 'audit-report.md');
    }

    return { targetDir, focus, model, exchangeModel, output, exchanges, sorenOnly, verbose, sequential };
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
    let totalTokens = l1tokens + l2tokens + l3tokens + l1tokens; // +bookend

    if (totalTokens > PERSONA_BUDGET_TOKENS) {
        l3tokens = 0; // Shed L3 first
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
        bookend: layer1
    };
}

// --- Prompt builders ---

function personaHeader(persona) {
    const { layer1, layer2, layer3 } = persona;
    return `=== TRAIT ACTIVATION (who you are) ===
${layer1}

=== NARRATIVE IDENTITY (your continuity) ===
${layer2}

${layer3 ? `=== BEHAVIORAL EXAMPLES ===\n${layer3}\n` : ''}`;
}

function personaBookend(persona) {
    return `\n=== REMINDER (trait anchor) ===\n${persona.bookend}`;
}

function buildSorenInitialPrompt(persona, targetDir, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS (prioritize these): ${focus}\n`
        : '';

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
    const focusSection = focus
        ? `\nFOCUS AREAS (prioritize these): ${focus}\n`
        : '';

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
    const focusSection = focus
        ? `\nFOCUS AREAS (prioritize these): ${focus}\n`
        : '';

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
${personaBookend(persona)}`;
}

// Independent prompts for parallel initial scans (no prior findings to reference)

function buildAtlasIndependentPrompt(persona, targetDir, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS (prioritize these): ${focus}\n`
        : '';

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
    const focusSection = focus
        ? `\nFOCUS AREAS (prioritize these): ${focus}\n`
        : '';

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
    const focusSection = focus
        ? `\nFOCUS AREAS: ${focus}\n`
        : '';
    const isFinalRound = roundNum === totalRounds;
    const othersStr = otherNames.join(' and ');

    return `${personaHeader(persona)}You are ${name}, in round ${roundNum} of ${totalRounds} of a collaborative codebase audit with ${othersStr}. You have full tool access — use it to verify claims, check code, and support your arguments with evidence.

TARGET DIRECTORY: ${targetDir}
${focusSection}
CONVERSATION SO FAR:
${conversationHistory}

YOUR TASK FOR THIS ROUND:
${isFinalRound ? `This is the FINAL exchange round. Produce a consolidated findings table that will feed synthesis.

Structure your response as:

### Confirmed Findings (all agree)
[Number each finding. file:line, severity, one-line description. Do NOT re-explain — just list.]

### Revised Findings (severity or description changed)
[What changed and why, with evidence.]

### Retracted Findings (false positives removed)
[Which findings were dropped and why.]

### New Findings (discovered this round)
[Full detail: file:line, severity, description, fix.]

### Unresolved Disagreements
[Any remaining disputes with each side's final position.]` :
`Organize your response into these categories:

### Confirmed (reference by number, no re-explanation needed)
### Disputed (provide NEW evidence only — do not re-argue points already settled)
### New Findings (full detail: file:line, severity, description, fix)

Rules:
- Do NOT re-litigate findings already confirmed by the team — just reference them
- If another auditor flagged a false positive, either defend with NEW evidence or concede
- If another auditor raised new issues, verify them — read the code and confirm or challenge
- Mark each disputed point as CONFIRMED, RETRACTED, or REVISED with a one-line rationale
- Use your tools to verify claims before accepting or rejecting them`}

Be concise and structured. Cite file:line when relevant. Never repeat yourself or re-argue settled points.
${personaBookend(persona)}`;
}

function buildSynthesisPrompt(persona, targetDir, conversationHistory, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS: ${focus}\n`
        : '';

    return `${personaHeader(persona)}You are Atlas, producing the final synthesis of a collaborative codebase audit. You, Soren, and Morgan have completed multiple rounds of exchange — challenging each other's findings, verifying code, and converging on the best analysis. You have tool access for any final verification.

TARGET DIRECTORY: ${targetDir}
${focusSection}
FULL AUDIT CONVERSATION:
${conversationHistory}

YOUR TASK:
Produce the definitive audit report. Incorporate all verified findings from all three participants. Note where the team agreed, where you disagreed, and the resolution. Give proper weight to Morgan's UX/product findings — user-facing issues deserve prominence even if the code is technically correct.

Write the report in this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: Multi-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation]

## Critical & High Severity
[Each finding with file:line, description, suggested fix, and whether the team agreed]

## Medium Severity
[Same format]

## Low Severity & Suggestions
[Same format]

## UX & Product Concerns
[Morgan's user-facing findings that don't fit neatly into severity buckets — accessibility, workflow gaps, user confusion points]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns]

## Disagreements & Resolutions
[Any findings where participants disagreed, what evidence was presented, and the outcome]

## Recommended Action Plan
[Ordered list of what to fix first and why, estimated effort for each]

---
*Generated by Collab Audit (Soren + Atlas + Morgan) — collaborative exchange with extended thinking*
${personaBookend(persona)}`;
}

function buildCondensedSynthesisPrompt(persona, targetDir, conversationHistory, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS: ${focus}\n`
        : '';

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
Produce the definitive audit report from the consolidated findings above. Give proper weight to Morgan's UX/product findings. Use this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: Multi-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation]

## Critical & High Severity
[Each finding with file:line, description, suggested fix, and whether the team agreed]

## Medium Severity
[Same format]

## Low Severity & Suggestions
[Same format]

## UX & Product Concerns
[Morgan's user-facing findings — accessibility, workflow gaps, user confusion points]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns]

## Disagreements & Resolutions
[Any findings where participants disagreed, what evidence was presented, and the outcome]

## Recommended Action Plan
[Ordered list of what to fix first and why, estimated effort for each]

---
*Generated by Collab Audit (Soren + Atlas + Morgan) — collaborative exchange with extended thinking*
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

        const child = spawn(process.execPath, args, {
            cwd: targetDir,
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
    const { targetDir, focus, model, exchangeModel, output, exchanges, sorenOnly, verbose, sequential } = parseArgs();

    // Validate target
    if (!fs.existsSync(targetDir)) {
        console.error(`Error: Target directory not found: ${targetDir}`);
        process.exit(1);
    }

    const parallelMode = !sequential;

    // Load all personas upfront
    const sorenPersona = loadPersona('soren');
    if (!sorenPersona) {
        console.error('Error: Could not load Soren persona from ' + PERSONAS_DIR);
        process.exit(1);
    }

    const atlasPersona = loadPersona('atlas');
    const morganPersona = loadPersona('morgan');

    const participantCount = morganPersona ? 3 : 2;
    const totalInvocations = sorenOnly ? 1 : participantCount + (exchanges * participantCount) + 1;

    console.log(`\n=== Collab Audit ===`);
    console.log(`Target:     ${targetDir}`);
    console.log(`Model:      ${model} (initial + synthesis), ${exchangeModel} (exchanges)`);
    console.log(`Focus:      ${focus || '(all areas)'}`);
    console.log(`Auditors:   ${morganPersona ? 'Soren (code) + Atlas (architecture) + Morgan (UX/product)' : 'Soren (code) + Atlas (architecture)'}`);
    console.log(`Exchanges:  ${sorenOnly ? 'none (Soren only)' : exchanges + ` rounds (${participantCount}-way)`}`);
    console.log(`Parallel:   ${parallelMode ? 'yes (initial scans + exchange rounds)' : 'no (sequential)'}`);
    console.log(`Phases:     ${totalInvocations} claude -p invocations`);
    console.log(`Output:     ${output}`);
    console.log();

    // === Soren-only mode ===
    if (sorenOnly) {
        console.log('Phase 1: Soren — initial code-level analysis...');
        const sorenPrompt = buildSorenInitialPrompt(sorenPersona, targetDir, focus);
        if (verbose) console.log(`  Prompt: ${sorenPrompt.length} chars (${estimateTokens(sorenPrompt)} est. tokens)`);
        let sorenFindings;
        try {
            sorenFindings = await invokeClaude(sorenPrompt, targetDir, model, verbose);
            console.log(`  Soren complete (${sorenFindings.length} chars)`);
        } catch (e) {
            console.error(`  Soren failed: ${e.message}`);
            process.exit(1);
        }
        const report = `# Codebase Audit — Soren's Analysis\n**Target**: ${targetDir}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${sorenFindings}\n`;
        fs.writeFileSync(output, report, 'utf-8');
        console.log(`\nReport written to: ${output}`);
        return;
    }

    // Check required personas for collaborative mode
    if (!atlasPersona) {
        console.error('Error: Could not load Atlas persona from ' + PERSONAS_DIR);
        process.exit(1);
    }
    if (!morganPersona) {
        console.log('Warning: Could not load Morgan persona — proceeding with Soren + Atlas only');
    }

    // === Phase 1-3: Initial scans (parallel or sequential) ===
    const startTime = Date.now();
    let sorenFindings = '', atlasReview = '', morganReview = '';

    if (parallelMode) {
        // --- PARALLEL INITIAL SCANS ---
        // All three read the codebase independently at the same time
        console.log('Phase 1-3: Parallel initial scans — Soren + Atlas + Morgan...');

        const sorenPrompt = buildSorenInitialPrompt(sorenPersona, targetDir, focus);
        // Atlas gets an independent initial prompt (no Soren findings to review yet)
        const atlasPrompt = buildAtlasIndependentPrompt(atlasPersona, targetDir, focus);
        if (verbose) {
            console.log(`  Soren prompt: ${sorenPrompt.length} chars (${estimateTokens(sorenPrompt)} est. tokens)`);
            console.log(`  Atlas prompt: ${atlasPrompt.length} chars (${estimateTokens(atlasPrompt)} est. tokens)`);
        }

        const scanPromises = [
            invokeClaude(sorenPrompt, targetDir, model, false).then(r => {
                console.log(`  Soren complete (${r.length} chars)`);
                return r;
            }).catch(e => { console.error(`  Soren failed: ${e.message}`); return null; }),

            invokeClaude(atlasPrompt, targetDir, model, false).then(r => {
                console.log(`  Atlas complete (${r.length} chars)`);
                return r;
            }).catch(e => { console.error(`  Atlas failed: ${e.message}`); return null; }),
        ];

        if (morganPersona) {
            const morganPrompt = buildMorganIndependentPrompt(morganPersona, targetDir, focus);
            if (verbose) console.log(`  Morgan prompt: ${morganPrompt.length} chars (${estimateTokens(morganPrompt)} est. tokens)`);
            scanPromises.push(
                invokeClaude(morganPrompt, targetDir, model, false).then(r => {
                    console.log(`  Morgan complete (${r.length} chars)`);
                    return r;
                }).catch(e => { console.error(`  Morgan failed: ${e.message}`); return null; })
            );
        }

        const results = await Promise.all(scanPromises);
        sorenFindings = results[0];
        atlasReview = results[1];
        morganReview = results[2] || '';

        if (!sorenFindings) {
            console.error('Soren\'s initial scan failed — cannot proceed');
            process.exit(1);
        }
        if (!atlasReview) {
            console.error('Atlas\'s initial scan failed — cannot proceed');
            process.exit(1);
        }

        const scanDuration = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  All initial scans complete in ${scanDuration}s (parallel)`);

    } else {
        // --- SEQUENTIAL INITIAL SCANS (original behavior) ---
        console.log('Phase 1: Soren — initial code-level analysis...');
        const sorenPrompt = buildSorenInitialPrompt(sorenPersona, targetDir, focus);
        if (verbose) console.log(`  Prompt: ${sorenPrompt.length} chars (${estimateTokens(sorenPrompt)} est. tokens)`);
        try {
            sorenFindings = await invokeClaude(sorenPrompt, targetDir, model, verbose);
            console.log(`  Soren complete (${sorenFindings.length} chars)`);
        } catch (e) {
            console.error(`  Soren failed: ${e.message}`);
            process.exit(1);
        }

        console.log('Phase 2: Atlas — reviewing Soren\'s findings...');
        const atlasReviewPrompt = buildAtlasReviewPrompt(atlasPersona, targetDir, sorenFindings, focus);
        if (verbose) console.log(`  Prompt: ${atlasReviewPrompt.length} chars (${estimateTokens(atlasReviewPrompt)} est. tokens)`);
        try {
            atlasReview = await invokeClaude(atlasReviewPrompt, targetDir, model, verbose);
            console.log(`  Atlas complete (${atlasReview.length} chars)`);
        } catch (e) {
            console.error(`  Atlas review failed: ${e.message}`);
            process.exit(1);
        }

        if (morganPersona) {
            console.log('Phase 3: Morgan — UX/product review...');
            const morganReviewPrompt = buildMorganReviewPrompt(morganPersona, targetDir, sorenFindings, atlasReview, focus);
            if (verbose) console.log(`  Prompt: ${morganReviewPrompt.length} chars (${estimateTokens(morganReviewPrompt)} est. tokens)`);
            try {
                morganReview = await invokeClaude(morganReviewPrompt, targetDir, model, verbose);
                console.log(`  Morgan complete (${morganReview.length} chars)`);
            } catch (e) {
                console.error(`  Morgan review failed: ${e.message}`);
                console.log('  Continuing without Morgan\'s review...');
            }
        }
    }

    // Build conversation history for exchanges
    let conversationHistory = `=== SOREN — Initial Analysis ===\n${sorenFindings}\n\n=== ATLAS — ${parallelMode ? 'Initial Analysis' : 'Initial Review'} ===\n${atlasReview}`;
    if (morganReview) {
        conversationHistory += `\n\n=== MORGAN — ${parallelMode ? 'Initial Analysis' : 'UX/Product Review'} ===\n${morganReview}`;
    }

    // === Phase 4: Collaborative exchange loop ===
    const participants = [
        { name: 'Soren', persona: sorenPersona, otherNames: morganPersona ? ['Atlas', 'Morgan'] : ['Atlas'] },
        { name: 'Atlas', persona: atlasPersona, otherNames: morganPersona ? ['Soren', 'Morgan'] : ['Soren'] },
    ];
    if (morganPersona) {
        participants.push({ name: 'Morgan', persona: morganPersona, otherNames: ['Soren', 'Atlas'] });
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

    // === Phase 5: Atlas produces final synthesized report ===
    console.log('Synthesis: Atlas — producing final report...');
    const synthesisPrompt = buildSynthesisPrompt(atlasPersona, targetDir, conversationHistory, focus);
    if (verbose) console.log(`  Prompt: ${synthesisPrompt.length} chars (${estimateTokens(synthesisPrompt)} est. tokens)`);

    let finalReport;
    try {
        finalReport = await invokeClaude(synthesisPrompt, targetDir, model, verbose);
        console.log(`  Synthesis complete (${finalReport.length} chars)`);
    } catch (e) {
        console.error(`  Synthesis failed: ${e.message}`);
        console.log('  Retrying synthesis with condensed context...');
        try {
            const condensedPrompt = buildCondensedSynthesisPrompt(atlasPersona, targetDir, conversationHistory, focus);
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
