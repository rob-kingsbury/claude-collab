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
 * Pipeline:
 *   1. Soren performs initial code-level audit with tool access
 *   2. Atlas reviews Soren's findings, pushes back, adds structural observations
 *   3. Collaborative exchange loop (configurable rounds) — they challenge,
 *      refine, and converge on findings
 *   4. Atlas produces final synthesized report incorporating all exchanges
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Configuration ---

const CLAUDE_CLI_JS = 'C:\\Users\\roban\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
const PERSONAS_DIR = 'C:\\claude-collab\\personas';
const DEFAULT_MODEL = 'opus';
const MAX_TURNS = 25;
const TIMEOUT_MS = 600000; // 10 minutes per invocation
const DEFAULT_EXCHANGES = 3; // Number of collaborative back-and-forth rounds
const CONTEXT_WINDOW_TOKENS = 200000;
const PERSONA_BUDGET_RATIO = 0.15; // Slightly lower than chatroom — leave room for codebase
const PERSONA_BUDGET_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * PERSONA_BUDGET_RATIO);

// --- Argument parsing ---

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
Collab Audit — Collaborative codebase analysis with Soren & Atlas

Usage:
  node audit.js <target-directory> [options]

Options:
  --focus "areas"     Comma-separated focus areas (e.g., "security,performance,architecture")
  --exchanges N       Number of collaborative exchange rounds (default: 3, range: 1-6)
  --model <model>     Model to use (default: opus). Options: opus, sonnet, haiku
  --output <path>     Output file path (default: <target>/audit-report.md)
  --soren-only        Run only Soren's pass (skip collaboration)
  --verbose           Show real-time progress
  --help, -h          Show this help

Examples:
  node audit.js c:\\xampp\\htdocs\\ai-ta
  node audit.js c:\\xampp\\htdocs\\bandpilot --focus "security,sql-injection,xss"
  node audit.js . --output c:\\audits\\myproject-audit.md
`);
        process.exit(0);
    }

    let targetDir = path.resolve(args[0]);
    let focus = '';
    let model = DEFAULT_MODEL;
    let output = '';
    let exchanges = DEFAULT_EXCHANGES;
    let sorenOnly = false;
    let verbose = false;

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--focus': focus = args[++i] || ''; break;
            case '--exchanges': exchanges = Math.min(6, Math.max(1, parseInt(args[++i]) || DEFAULT_EXCHANGES)); break;
            case '--model': model = args[++i] || DEFAULT_MODEL; break;
            case '--output': output = args[++i] || ''; break;
            case '--soren-only': sorenOnly = true; break;
            case '--verbose': verbose = true; break;
        }
    }

    if (!output) {
        output = path.join(targetDir, 'audit-report.md');
    }

    return { targetDir, focus, model, output, exchanges, sorenOnly, verbose };
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

After your initial analysis, Atlas will review your findings and push back. You'll then have ${DEFAULT_EXCHANGES} rounds of collaborative exchange to challenge each other's findings, refine assessments, and converge on the best analysis. So be thorough but know that Atlas will verify and challenge you.

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

function buildExchangePrompt(persona, name, otherName, targetDir, conversationHistory, roundNum, totalRounds, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS: ${focus}\n`
        : '';
    const isFinalRound = roundNum === totalRounds;

    return `${personaHeader(persona)}You are ${name}, in round ${roundNum} of ${totalRounds} of a collaborative codebase audit with ${otherName}. You have full tool access — use it to verify claims, check code, and support your arguments with evidence.

TARGET DIRECTORY: ${targetDir}
${focusSection}
CONVERSATION SO FAR:
${conversationHistory}

YOUR TASK FOR THIS ROUND:
${isFinalRound ? `This is the FINAL exchange round. Produce a consolidated findings table that will feed synthesis.

Structure your response as:

### Confirmed Findings (both agree)
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
- Do NOT re-litigate findings already confirmed by both parties — just reference them
- If ${otherName} flagged a false positive, either defend with NEW evidence or concede
- If ${otherName} raised new issues, verify them — read the code and confirm or challenge
- Mark each disputed point as CONFIRMED, RETRACTED, or REVISED with a one-line rationale
- Use your tools to verify claims before accepting or rejecting them`}

Be concise and structured. Cite file:line when relevant. Never repeat yourself or re-argue settled points.
${personaBookend(persona)}`;
}

function buildSynthesisPrompt(persona, targetDir, conversationHistory, focus) {
    const focusSection = focus
        ? `\nFOCUS AREAS: ${focus}\n`
        : '';

    return `${personaHeader(persona)}You are Atlas, producing the final synthesis of a collaborative codebase audit. You and Soren have completed multiple rounds of exchange — challenging each other's findings, verifying code, and converging on the best analysis. You have tool access for any final verification.

TARGET DIRECTORY: ${targetDir}
${focusSection}
FULL AUDIT CONVERSATION:
${conversationHistory}

YOUR TASK:
Produce the definitive audit report. Incorporate all verified findings from both participants. Note where you and Soren agreed, where you disagreed, and the resolution.

Write the report in this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis)
**Method**: ${DEFAULT_EXCHANGES}-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation]

## Critical & High Severity
[Each finding with file:line, description, suggested fix, and whether both auditors agreed]

## Medium Severity
[Same format]

## Low Severity & Suggestions
[Same format]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns]

## Disagreements & Resolutions
[Any findings where participants disagreed, what evidence was presented, and the outcome]

## Recommended Action Plan
[Ordered list of what to fix first and why, estimated effort for each]

---
*Generated by Collab Audit (Soren + Atlas) — ${DEFAULT_EXCHANGES}-round collaborative exchange using Claude Opus 4.6 with extended thinking*
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

    return `${personaHeader(persona)}You are Atlas, producing the final synthesis of a collaborative codebase audit. The full exchange was too long for a single synthesis pass, so you're working from the final exchange round where findings were consolidated.

TARGET DIRECTORY: ${targetDir}
${focusSection}
FINAL EXCHANGE ROUND (findings should be consolidated here):
${condensed}

YOUR TASK:
Produce the definitive audit report from the consolidated findings above. Use this exact structure:

# Codebase Audit Report
**Target**: ${targetDir}
**Date**: ${new Date().toISOString().split('T')[0]}
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis)
**Method**: Multi-round collaborative exchange with mutual verification

## Executive Summary
[2-3 sentences: overall health, critical issues count, top recommendation]

## Critical & High Severity
[Each finding with file:line, description, suggested fix, and whether both auditors agreed]

## Medium Severity
[Same format]

## Low Severity & Suggestions
[Same format]

## Architectural Observations
[Structural patterns, coupling analysis, broader concerns]

## Disagreements & Resolutions
[Any findings where participants disagreed, what evidence was presented, and the outcome]

## Recommended Action Plan
[Ordered list of what to fix first and why, estimated effort for each]

---
*Generated by Collab Audit (Soren + Atlas) — collaborative exchange using Claude Opus 4.6 with extended thinking*
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
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis)
**Method**: Multi-round collaborative exchange (synthesis phase failed — this is an auto-generated summary)
${focus ? `**Focus**: ${focus}\n` : ''}
## Note
The AI synthesis phase failed twice. This report contains the raw exchange log below. Approximate finding counts from the exchange: ~${counts.CRITICAL} critical, ~${counts.HIGH} high, ~${counts.MEDIUM} medium, ~${counts.LOW} low (~${estUnique} estimated unique findings).

Review the exchange log for the actual findings — the final exchange round typically contains the most consolidated view.

---

${conversationHistory}

---
*Generated by Collab Audit (Soren + Atlas) — synthesis failed, raw exchange preserved*
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
    const { targetDir, focus, model, output, exchanges, sorenOnly, verbose } = parseArgs();

    // Validate target
    if (!fs.existsSync(targetDir)) {
        console.error(`Error: Target directory not found: ${targetDir}`);
        process.exit(1);
    }

    const totalInvocations = sorenOnly ? 1 : 2 + (exchanges * 2) + 1; // initial + review + exchanges + synthesis
    console.log(`\n=== Collab Audit ===`);
    console.log(`Target:     ${targetDir}`);
    console.log(`Model:      ${model}`);
    console.log(`Focus:      ${focus || '(all areas)'}`);
    console.log(`Exchanges:  ${sorenOnly ? 'none (Soren only)' : exchanges + ' rounds'}`);
    console.log(`Phases:     ${totalInvocations} claude -p invocations`);
    console.log(`Output:     ${output}`);
    console.log();

    // Load personas
    const sorenPersona = loadPersona('soren');
    if (!sorenPersona) {
        console.error('Error: Could not load Soren persona from ' + PERSONAS_DIR);
        process.exit(1);
    }

    // === Phase 1: Soren's initial code-level audit ===
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

    if (sorenOnly) {
        const report = `# Codebase Audit — Soren's Analysis\n**Target**: ${targetDir}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${sorenFindings}\n`;
        fs.writeFileSync(output, report, 'utf-8');
        console.log(`\nReport written to: ${output}`);
        return;
    }

    // Load Atlas persona
    const atlasPersona = loadPersona('atlas');
    if (!atlasPersona) {
        console.error('Error: Could not load Atlas persona from ' + PERSONAS_DIR);
        const report = `# Codebase Audit — Soren's Analysis (Atlas unavailable)\n**Target**: ${targetDir}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${sorenFindings}\n`;
        fs.writeFileSync(output, report, 'utf-8');
        console.log(`\nReport written to: ${output} (Soren only — Atlas persona not found)`);
        return;
    }

    // === Phase 2: Atlas's initial review of Soren's findings ===
    console.log('Phase 2: Atlas — reviewing Soren\'s findings...');
    const atlasReviewPrompt = buildAtlasReviewPrompt(atlasPersona, targetDir, sorenFindings, focus);
    if (verbose) console.log(`  Prompt: ${atlasReviewPrompt.length} chars (${estimateTokens(atlasReviewPrompt)} est. tokens)`);

    let atlasReview;
    try {
        atlasReview = await invokeClaude(atlasReviewPrompt, targetDir, model, verbose);
        console.log(`  Atlas complete (${atlasReview.length} chars)`);
    } catch (e) {
        console.error(`  Atlas review failed: ${e.message}`);
        const report = `# Codebase Audit — Soren's Analysis (Atlas phase failed)\n**Target**: ${targetDir}\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n${sorenFindings}\n`;
        fs.writeFileSync(output, report, 'utf-8');
        console.log(`\nReport written to: ${output} (Soren only — Atlas failed: ${e.message})`);
        return;
    }

    // Build conversation history for exchanges
    let conversationHistory = `=== SOREN — Initial Analysis ===\n${sorenFindings}\n\n=== ATLAS — Initial Review ===\n${atlasReview}`;

    // === Phase 3: Collaborative exchange loop ===
    // Each round: Soren responds, then Atlas responds
    const participants = [
        { name: 'Soren', persona: sorenPersona, otherName: 'Atlas' },
        { name: 'Atlas', persona: atlasPersona, otherName: 'Soren' }
    ];

    for (let round = 1; round <= exchanges; round++) {
        let breakOuter = false;
        for (const participant of participants) {
            const label = `Exchange ${round}/${exchanges}`;
            console.log(`${label}: ${participant.name} responding to ${participant.otherName}...`);

            const prompt = buildExchangePrompt(
                participant.persona,
                participant.name,
                participant.otherName,
                targetDir,
                conversationHistory,
                round,
                exchanges,
                focus
            );

            if (verbose) console.log(`  Prompt: ${prompt.length} chars (${estimateTokens(prompt)} est. tokens)`);

            // Warn if context is getting large
            const historyTokens = estimateTokens(conversationHistory);
            if (historyTokens > CONTEXT_WINDOW_TOKENS * 0.6) {
                console.log(`  Warning: conversation history at ~${historyTokens} tokens — approaching context limit`);
            }

            try {
                const response = await invokeClaude(prompt, targetDir, model, verbose);
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

    // === Phase 4: Atlas produces final synthesized report ===
    console.log('Synthesis: Atlas — producing final report...');
    const synthesisPrompt = buildSynthesisPrompt(atlasPersona, targetDir, conversationHistory, focus);
    if (verbose) console.log(`  Prompt: ${synthesisPrompt.length} chars (${estimateTokens(synthesisPrompt)} est. tokens)`);

    let finalReport;
    try {
        finalReport = await invokeClaude(synthesisPrompt, targetDir, model, verbose);
        console.log(`  Synthesis complete (${finalReport.length} chars)`);
    } catch (e) {
        console.error(`  Synthesis failed: ${e.message}`);
        // Retry with condensed prompt (last exchange round only, reduces context pressure)
        console.log('  Retrying synthesis with condensed context...');
        try {
            const condensedPrompt = buildCondensedSynthesisPrompt(atlasPersona, targetDir, conversationHistory, focus);
            if (verbose) console.log(`  Condensed prompt: ${condensedPrompt.length} chars (${estimateTokens(condensedPrompt)} est. tokens)`);
            finalReport = await invokeClaude(condensedPrompt, targetDir, model, verbose);
            console.log(`  Condensed synthesis complete (${finalReport.length} chars)`);
        } catch (e2) {
            console.error(`  Condensed synthesis also failed: ${e2.message}`);
            // Final fallback: auto-generate minimal report from raw exchange
            finalReport = buildFallbackReport(targetDir, conversationHistory, focus);
            console.log('  Generated fallback report from exchange log');
        }
    }

    // Write final report
    fs.writeFileSync(output, finalReport, 'utf-8');
    console.log(`\n=== Audit Complete ===`);
    console.log(`Report: ${output}`);
    console.log(`Invocations used: initial + review + ${exchanges * 2} exchange turns + synthesis = ${totalInvocations}`);
}

main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
});
