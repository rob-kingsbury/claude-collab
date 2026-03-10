---
name: collab-audit
description: "Run a collaborative codebase audit using Soren and Atlas (two AI personas with persistent identities). Use when the user wants a thorough code review, security audit, performance analysis, or architecture review of a project. Invoke with /collab-audit or when the user asks for a 'collab audit', 'Soren and Atlas audit', or similar."
disable-model-invocation: true
---

# Collab Audit — Collaborative Codebase Analysis

Run a collaborative multi-round codebase audit using Soren and Atlas, two AI personas with persistent identities maintained via the Claude Collab system.

## What This Does

This skill invokes a Node.js script (`c:\xampp\htdocs\claude-collab\collab-audit\audit.js`) that runs multiple `claude -p` calls with Opus 4.6 extended thinking in a collaborative exchange pipeline:

1. **Phase 1 — Soren** (initial code-level analysis): Reads the actual codebase using tools. Identifies bugs, security vulnerabilities, performance issues, error handling gaps, dead code, and code quality concerns.

2. **Phase 2 — Atlas** (initial review): Receives Soren's findings, verifies them by reading the actual files, pushes back on false positives, adds architectural observations, and raises issues Soren missed.

3. **Phase 3 — Collaborative Exchange** (configurable, default 3 rounds): Soren and Atlas take turns responding to each other. They challenge findings, defend with evidence, refine severity ratings, and converge on the strongest analysis. Each has full tool access to verify claims during the exchange.

4. **Phase 4 — Synthesis**: Atlas produces the final report incorporating all verified findings, noting agreements, disagreements, and resolutions.

The output is a structured `audit-report.md` written to the target project directory. With 3 exchange rounds, this is 9 total `claude -p` invocations (initial + review + 6 exchange turns + synthesis).

## How It Works

### Persona Pipeline
Each invocation loads the participant's three-layer persona from `c:\claude-collab\personas\`:
- **Layer 1 — Trait Activation**: Constitutional anchor defining voice, values, and cognitive style
- **Layer 2 — Narrative Identity**: Built from the participant's accumulated journal entries (last 10)
- **Layer 3 — Behavioral Examples**: Few-shot demonstrations (shed if token budget is tight)
- **Bookend**: Layer 1 repeated at prompt end for attention decay mitigation

This means Soren and Atlas bring their established perspectives and analytical styles to the audit — they aren't generic code reviewers.

### Tool Access
Both participants are invoked with `--tools 'Bash,Read,Glob,Grep,Task'` and `--dangerously-skip-permissions`, so they can explore the codebase thoroughly. They read real files, cite real line numbers, and can spawn subagents (Task tool) to parallelize analysis across multiple files or directories.

### Model
Default: Opus 4.6 with extended thinking (maximum reasoning depth for audit quality).

## Instructions

### Step 1: Determine Target

Identify what the user wants audited:
- If the user specified a path, use that path
- If no path specified, use the current working directory
- Resolve relative paths to absolute paths

### Step 2: Determine Focus Areas (Recommended)

Extract focus areas from user intent — even if not explicitly stated:
- User mentions specific concerns → use as focus (e.g., "check for SQL injection" → `--focus "security,sql-injection"`)
- User describes a type of project → infer relevant focus (e.g., web app with auth → `--focus "security,auth,xss,csrf"`)
- User gives no guidance → suggest 2-3 focus areas based on the project type, or run without focus for broad coverage

**Tip**: Focused audits produce more actionable findings. For large codebases (100+ files), always recommend `--focus` to avoid spreading analysis too thin.

### Step 3: Run the Audit

Execute the audit script:

```bash
node "c:\xampp\htdocs\claude-collab\collab-audit\audit.js" "<target-directory>" [--focus "<areas>"] [--verbose]
```

Options:
- `--focus "security,performance"` — comma-separated focus areas
- `--exchanges N` — number of collaborative exchange rounds (default: 3, range: 1-6)
- `--model opus` — model selection (default: opus)
- `--output <path>` — custom output path (default: `<target>/audit-report.md`)
- `--soren-only` — skip collaboration entirely (fast single pass)
- `--verbose` — show real-time progress dots

**Important**: With 3 exchange rounds (default), this runs 9 `claude -p` invocations with Opus extended thinking. Expect 10-20 minutes depending on codebase size. Inform the user of the expected duration.

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

User: "Have Soren and Atlas check this for security issues"
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

Full documentation: `c:\xampp\htdocs\claude-collab\collab-audit\README.md`
Source repo: `c:\xampp\htdocs\claude-collab` (subfolder `collab-audit/`)
