---
name: collab-audit
description: "Run a collaborative codebase audit using Soren, Atlas, and Morgan (AI personas with persistent identities). Use when the user wants a thorough code review, security audit, performance analysis, or architecture review of a project. Invoke with /collab-audit or when the user asks for a 'collab audit', 'team audit', or similar."
disable-model-invocation: false
---

# Collab Audit — Collaborative Codebase Analysis

Run a collaborative multi-round codebase audit using Soren, Atlas, and Morgan — AI personas with persistent identities maintained via the Claude Collab system.

## What This Does

This skill invokes a Node.js script (`c:\xampp\htdocs\claude-collab\collab-audit\audit.js`) that runs multiple `claude -p` calls with Opus 4.6 extended thinking in a collaborative exchange pipeline:

1. **Phase 1 — Soren** (initial code-level analysis): Reads the actual codebase using tools. Identifies bugs, security vulnerabilities, performance issues, error handling gaps, dead code, and code quality concerns.

2. **Phase 2 — Atlas** (initial review): Receives Soren's findings, verifies them by reading the actual files, pushes back on false positives, adds architectural observations, and raises issues Soren missed.

3. **Phase 3 — Morgan** (UX/product review): Receives both Soren's and Atlas's findings, evaluates user-facing impact, identifies UX vulnerabilities (accessibility, missing feedback, confusing workflows), product logic gaps, and re-prioritizes severity based on human impact.

4. **Phase 4 — Collaborative Exchange** (configurable, default 3 rounds): All three participants take turns responding to each other. They challenge findings, defend with evidence, refine severity ratings, and converge on the strongest analysis. Each has full tool access to verify claims during the exchange.

5. **Phase 5 — Synthesis**: Atlas produces the final report incorporating all verified findings from all three auditors, noting agreements, disagreements, and resolutions. Includes a dedicated UX & Product Concerns section.

The output is a structured `audit-report.md` written to the target project directory. With 2 exchange rounds (default), this is 10 total `claude -p` invocations (3 initial + 6 exchange turns + synthesis). Initial scans and exchange rounds run in parallel by default.

## How It Works

### Persona Pipeline
Each invocation loads the participant's three-layer persona from `c:\claude-collab\personas\`:
- **Layer 1 — Trait Activation**: Constitutional anchor defining voice, values, and cognitive style
- **Layer 2 — Narrative Identity**: Built from the participant's accumulated journal entries (last 10)
- **Layer 3 — Behavioral Examples**: Few-shot demonstrations (shed if token budget is tight)
- **Bookend**: Layer 1 repeated at prompt end for attention decay mitigation

This means participants bring their established perspectives and analytical styles to the audit — they aren't generic code reviewers. Soren focuses on code-level precision, Atlas on structural integrity, and Morgan on UX/product implications.

### Tool Access
All three participants are invoked with `--tools 'Bash,Read,Glob,Grep,Task'` and `--dangerously-skip-permissions`, so they can explore the codebase thoroughly. They read real files, cite real line numbers, and can spawn subagents (Task tool) to parallelize analysis across multiple files or directories.

### Model
Default: Opus 4.6 with extended thinking (maximum reasoning depth for audit quality).

## Instructions

### Step 1: Determine Target

Identify what the user wants audited:
- If the user specified a path, use that path
- If no path specified, use the current working directory
- Resolve relative paths to absolute paths

### Step 2: Determine Focus Areas (Recommended)

Extract focus areas from user intent — even if not explicitly stated. The `--focus` flag steers ALL three auditors toward the same priority, so choosing the right focus is critical.

**Focus routing by audit type:**

| User intent | Focus flag | Effect |
|-------------|-----------|--------|
| UX/UI audit | `--focus "ux,accessibility,user-workflows,error-messaging"` | Soren hunts code that breaks UX, Atlas checks architecture impacts UX, Morgan leads UX analysis |
| Security audit | `--focus "security,injection,auth,xss,csrf,path-traversal"` | Soren finds vulnerabilities, Atlas checks auth architecture, Morgan evaluates user-facing security (error leakage, confusing auth flows) |
| Performance audit | `--focus "performance,queries,caching,rendering,memory"` | Soren finds bottlenecks, Atlas checks scaling patterns, Morgan flags user-perceived slowness |
| Architecture review | `--focus "architecture,coupling,dependencies,patterns,modularity"` | Soren checks implementation consistency, Atlas leads structural analysis, Morgan evaluates developer experience |
| Code quality | `--focus "code-quality,dead-code,duplication,naming,error-handling"` | Soren leads code-level sweep, Atlas checks pattern consistency, Morgan evaluates maintainability for future contributors |
| Full audit | no `--focus` flag | Broad coverage across all domains — all three auditors use their full lens |

**Mapping user language to focus:**
- "check the UX" / "is this usable" / "accessibility" / "user experience" → UX focus
- "is this secure" / "find vulnerabilities" / "pentest" → Security focus
- "why is it slow" / "optimize" / "performance" → Performance focus
- "review the architecture" / "is this well-structured" / "tech debt" → Architecture focus
- "general audit" / "full review" / no specific ask → No focus (broad)

**Tip**: Focused audits produce more actionable findings. For large codebases (100+ files), always recommend `--focus` to avoid spreading analysis too thin.

### Step 3: Run the Audit

Execute the audit script:

```bash
node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "<target-directory>" [--focus "<areas>"] [--verbose]
```

Options:
- `--focus "security,performance"` — comma-separated focus areas
- `--exchanges N` — number of exchange rounds (default: 2, range: 1-6)
- `--model opus` — model for initial scans + synthesis (default: opus)
- `--exchange-model sonnet` — model for exchange rounds (default: sonnet, use "opus" for max depth)
- `--output <path>` — custom output path (default: `<target>/audit-report.md`)
- `--sequential` — disable parallel execution (run all phases one at a time)
- `--soren-only` — skip collaboration entirely (fast single pass)
- `--verbose` — show real-time progress dots

**Performance**: Default mode runs initial scans in parallel and exchange rounds in parallel, with Sonnet for exchanges. With 2 exchange rounds, expect **8-15 minutes** depending on codebase size. Use `--sequential` if you want the original pipeline where each phase sees prior findings before starting.

### Step 4: Present Results

After the script completes:
1. Read the generated `audit-report.md`
2. Present the executive summary to the user
3. Highlight critical and high severity findings
4. Offer to walk through specific sections or help implement fixes

### Step 5: Track Efficacy (Optional)

If the project has a `c:\xampp\htdocs\claude-collab\collab-audit\logs\` directory, the results are automatically logged there for cross-session review of audit quality.

## Examples

```
User: "Run a collab audit on this project"
→ node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "C:\xampp\htdocs\current-project" --verbose

User: "Have the team check this for security issues"
→ node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "C:\xampp\htdocs\current-project" --focus "security" --verbose

User: "/collab-audit c:\xampp\htdocs\ai-ta"
→ node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "c:\xampp\htdocs\ai-ta" --verbose

User: "Quick audit, just Soren's pass"
→ node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "C:\xampp\htdocs\current-project" --soren-only --verbose
```

## Architecture Reference

The canonical audit script lives at `c:\xampp\htdocs\claude-collab\collab-audit\audit.js` (version controlled in the claude-collab git repo). Personas are stored at:
- `c:\claude-collab\personas\soren.md` + `soren-journal.md`
- `c:\claude-collab\personas\atlas.md` + `atlas-journal.md`
- `c:\claude-collab\personas\morgan.md` + `morgan-journal.md`

Full documentation: `c:\xampp\htdocs\claude-collab\collab-audit\README.md`
Source repo: `c:\xampp\htdocs\claude-collab` (subfolder `collab-audit/`)
