# Collab Audit

Collaborative codebase auditing using Soren and Atlas — two AI personas with persistent identities from the Claude Collab system.

## Overview

Collab Audit runs a multi-round collaborative analysis pipeline:

| Phase | Participant | Role |
|-------|-------------|------|
| 1 — Initial Analysis | **Soren** | Code-level audit: bugs, security, performance, error handling, code quality |
| 2 — Initial Review | **Atlas** | Verify Soren's findings, push back on false positives, add architectural observations |
| 3 — Exchange (x3) | **Both** | Challenge each other's findings, defend with evidence, refine, converge |
| 4 — Synthesis | **Atlas** | Final report incorporating all verified findings, agreements, and resolutions |

Both participants use Opus 4.6 with extended thinking and have full codebase access via Claude Code tools (Read, Glob, Grep, Bash, Task).

## How It Works

### Persona Injection

Each invocation loads the participant's three-layer persona:

```
┌─────────────────────────────────┐
│ Layer 1: Trait Activation       │  ← Constitutional anchor (never shed)
│ Layer 2: Narrative Identity     │  ← From journal (last 10 entries)
│ Layer 3: Behavioral Examples    │  ← Few-shot demos (shed first if tight)
├─────────────────────────────────┤
│ Audit Prompt + Codebase Access  │
├─────────────────────────────────┤
│ Bookend: Layer 1 Repeated      │  ← Attention decay mitigation
└─────────────────────────────────┘
```

Personas live at `c:\claude-collab\personas\` and are maintained by the Claude Collab watcher system. Soren and Atlas bring distinct analytical perspectives shaped by accumulated session experience.

### Pipeline

```
Target Directory
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  Phase 1     │────▶│  Soren's     │
│  Soren audit │     │  findings    │
└──────────────┘     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Phase 2     │
                     │  Atlas review│
                     └──────┬───────┘
                            │
                  ┌─────────┴─────────┐
                  │  Phase 3          │
                  │  Exchange loop    │
                  │  (3 rounds)       │
                  │                   │
                  │  Soren ◄──► Atlas │
                  │  challenge,       │
                  │  verify, refine   │
                  └─────────┬─────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Phase 4     │
                     │  Atlas       │
                     │  synthesis   │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ audit-report │
                     │    .md       │
                     └──────────────┘
```

### Why Collaborative Exchange Matters

Single-pass audits miss things. The exchange loop is where the real value comes from:
- Soren finds a potential SQL injection → Atlas verifies by reading the code → confirms or flags as false positive
- Atlas identifies an architectural concern → Soren checks if it causes actual bugs → refines severity
- One raises an issue the other missed → the other verifies and adds supporting evidence
- They converge on higher-quality conclusions than either would produce alone

### Severity Ratings

| Rating | Meaning |
|--------|---------|
| CRITICAL | Security vulnerability, data loss risk, or crash in production |
| HIGH | Significant bug or performance issue likely affecting users |
| MEDIUM | Code quality issue, minor bug, or optimization opportunity |
| LOW | Suggestion, style concern, or minor improvement |

## Usage

### From Any Claude Code Session (Global Skill)

```
/collab-audit
```

Or just ask naturally:
- "Run a collab audit on this project"
- "Have Soren and Atlas review this codebase"
- "Security audit with the collab team"

The skill is installed globally at `~/.claude/skills/collab-audit/SKILL.md`.

### Direct CLI

```bash
# Full collaborative audit (9 invocations with 3 exchange rounds)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project

# Focused audit
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --focus "security,sql-injection"

# More exchange rounds for thorough analysis
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --exchanges 5

# Quick pass (Soren only, no collaboration)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --soren-only

# Custom output location
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --output c:\audits\report.md

# Verbose (progress dots)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --verbose
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--focus "areas"` | all areas | Comma-separated focus: security, performance, architecture, etc. |
| `--exchanges N` | 3 | Number of collaborative exchange rounds (range: 1-6) |
| `--model <model>` | opus | Model: opus, sonnet, haiku |
| `--output <path>` | `<target>/audit-report.md` | Where to write the report |
| `--soren-only` | false | Skip collaboration (single pass) |
| `--verbose` | false | Show progress during invocation |

### Tool Access

Both participants have access to:
- **Read** — read file contents
- **Glob** — find files by pattern
- **Grep** — search file contents
- **Bash** — run commands
- **Task** — spawn subagents for parallel analysis

## Output Format

The report follows a consistent structure:

```markdown
# Codebase Audit Report
**Target**: <path>
**Date**: YYYY-MM-DD
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis)
**Method**: 3-round collaborative exchange with mutual verification

## Executive Summary
## Critical & High Severity
## Medium Severity
## Low Severity & Suggestions
## Architectural Observations
## Disagreements & Resolutions
## Recommended Action Plan
```

## Timing

With 3 exchange rounds (default), expect **10-25 minutes** depending on codebase size. Each Opus invocation with extended thinking and tool usage takes 2-5 minutes.

| Codebase Size | Exchanges | Est. Duration | Invocations |
|---------------|-----------|---------------|-------------|
| Small (~20 files) | 3 | ~10 min | 9 |
| Medium (~100 files) | 3 | ~15 min | 9 |
| Large (~500+ files) | 3 | ~25 min | 9 |
| Quick pass (--soren-only) | 0 | ~3-5 min | 1 |

## Logs

Audit logs are stored in `collab-audit/logs/` for tracking audit quality across sessions and projects.

## Files

| File | Location | Purpose |
|------|----------|---------|
| `audit.js` | `collab-audit/audit.js` | Main audit script (canonical, version controlled) |
| `SKILL.md` | `collab-audit/SKILL.md` | Skill definition (canonical, version controlled) |
| `README.md` | `collab-audit/README.md` | This documentation |
| `logs/` | `collab-audit/logs/` | Audit result logs |
| Global skill | `~/.claude/skills/collab-audit/SKILL.md` | Copy of SKILL.md for global access |

## Dependencies

- Node.js (for running audit.js)
- Claude Code CLI (`claude -p`) — uses Rob's Max Pro 20x subscription
- Persona files at `c:\claude-collab\personas\` (maintained by the Claude Collab watcher system)

No npm packages required. No API keys. Runs entirely through subscription interfaces.
