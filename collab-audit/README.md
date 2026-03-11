# Collab Audit

Collaborative codebase auditing using Soren, Atlas, and Morgan — AI personas with persistent identities from the Claude Collab system.

## Overview

Collab Audit runs a multi-round collaborative analysis pipeline:

| Phase | Participant | Role |
|-------|-------------|------|
| 1 — Initial Analysis | **Soren** | Code-level audit: bugs, security, performance, error handling, code quality |
| 2 — Structural Review | **Atlas** | Verify Soren's findings, push back on false positives, add architectural observations |
| 3 — UX/Product Review | **Morgan** | Evaluate user-facing impact, re-prioritize severity, identify UX vulnerabilities and product logic gaps |
| 4 — Exchange (x3) | **All three** | 3-way challenge: defend with evidence, refine severity, converge on strongest analysis |
| 5 — Synthesis | **Atlas** | Final report incorporating all verified findings, agreements, disagreements, and resolutions |

Initial scans and synthesis use Opus 4.6 with extended thinking. Exchange rounds default to Sonnet 4.6 for speed (configurable to Opus). All participants have full codebase access via Claude Code tools (Read, Glob, Grep, Bash, Task). Initial scans and exchange rounds run in parallel by default.

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

Personas live at `c:\claude-collab\personas\` and are loaded fresh at invocation time. Soren, Atlas, and Morgan bring distinct analytical perspectives shaped by accumulated session experience.

### Pipeline (Default: Parallel Mode)

```
Target Directory
       │
       ├─────────────┬─────────────┐
       ▼             ▼             ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  Soren     │ │  Atlas     │ │  Morgan    │
│  code scan │ │  arch scan │ │  UX scan   │
│  (Opus)    │ │  (Opus)    │ │  (Opus)    │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      └──────────────┼──────────────┘
                     ▼
      ┌──────────────────────────────┐
      │  Exchange rounds (parallel)  │
      │  (Sonnet — 2 rounds default) │
      │                              │
      │  Round N: all 3 respond to   │
      │  prior round simultaneously  │
      └──────────────┬───────────────┘
                     ▼
              ┌──────────────┐
              │  Atlas       │
              │  synthesis   │
              │  (Opus)      │
              └──────┬───────┘
                     ▼
              ┌──────────────┐
              │ audit-report │
              │    .md       │
              └──────────────┘
```

### Pipeline (Sequential Mode: `--sequential`)

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
                     │  Atlas review│  ← sees Soren's findings
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Phase 3     │
                     │  Morgan UX   │  ← sees both prior analyses
                     │  review      │
                     └──────┬───────┘
                            │
                  ┌─────────┴─────────┐
                  │  Exchange loop    │
                  │  (sequential)     │
                  │  Soren → Atlas →  │
                  │  Morgan per round │
                  └─────────┬─────────┘
                            │
                            ▼
                     ┌──────────────┐
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

### Parallel vs Sequential

| Mode | Speed | Tradeoff |
|------|-------|----------|
| **Parallel** (default) | ~8-15 min | Initial scans are independent — each auditor explores the codebase fresh without seeing others' findings. Exchange rounds converge findings afterward. |
| **Sequential** (`--sequential`) | ~20-35 min | Each phase sees all prior findings. Atlas can verify Soren's claims. Morgan can re-prioritize both. Deeper cross-referencing in initial phases, but 2-3x slower. |

Parallel mode is recommended for most audits. The exchange rounds do the heavy lifting of cross-referencing and convergence regardless of initial scan mode.

### Pipeline Order Rationale

The pipeline follows a **gather facts → verify → reframe for humans** sequence:
- **Soren first**: Evidence gatherer. Reads every file, cites every line number. Produces the raw code-level findings that Atlas and Morgan need to do their best work.
- **Atlas second**: Structural verifier. Checks Soren's claims against the actual codebase, challenges false positives, adds architectural context.
- **Morgan third**: Human-impact reframer. Re-evaluates severity from a user perspective. A "LOW" code smell that causes user confusion becomes a "HIGH" product issue.
- **Exchange rounds** equalize — all three participants can raise new issues, challenge each other, and push back regardless of initial order.

### Focus-Based Routing

The `--focus` flag steers ALL three auditors toward the same priority:

| Audit Type | Focus Flag | Effect |
|------------|-----------|--------|
| UX/UI | `--focus "ux,accessibility,user-workflows,error-messaging"` | Soren hunts code that breaks UX, Atlas checks architecture impacts, Morgan leads UX analysis |
| Security | `--focus "security,injection,auth,xss,csrf,path-traversal"` | Soren finds vulnerabilities, Atlas checks auth architecture, Morgan evaluates user-facing security |
| Performance | `--focus "performance,queries,caching,rendering,memory"` | Soren finds bottlenecks, Atlas checks scaling patterns, Morgan flags user-perceived slowness |
| Architecture | `--focus "architecture,coupling,dependencies,patterns,modularity"` | Soren checks implementation consistency, Atlas leads structural analysis, Morgan evaluates developer experience |
| Code Quality | `--focus "code-quality,dead-code,duplication,naming,error-handling"` | Soren leads code-level sweep, Atlas checks pattern consistency, Morgan evaluates maintainability |
| Full Audit | no `--focus` | Broad coverage — all three auditors use their full lens |

### Why Collaborative Exchange Matters

Single-pass audits miss things. The 3-way exchange loop is where the real value comes from:
- Soren finds a potential SQL injection → Atlas verifies by reading the code → confirms or flags as false positive
- Atlas identifies an architectural concern → Soren checks if it causes actual bugs → refines severity
- Morgan re-prioritizes a "LOW" code smell as "HIGH" because it confuses users → team discusses and converges
- One raises an issue the others missed → they verify and add supporting evidence
- Three perspectives converge on higher-quality conclusions than any would produce alone

### Exchange Structure

Exchange rounds use structured categories to prevent re-litigating resolved points:
- **Confirmed** — findings the team agrees on (referenced by number, no re-explanation)
- **Disputed** — findings requiring new evidence to resolve
- **New** — findings discovered during the exchange

The final round produces a consolidated findings table (Confirmed / Revised / Retracted / New / Unresolved) that feeds directly into synthesis.

### Synthesis Resilience

If synthesis fails (e.g., context too long after many exchange rounds), the pipeline:
1. **Retries** with a condensed prompt using only the last exchange round
2. **Falls back** to an auto-generated report with severity counts extracted from the exchange log

This ensures you always get a usable output, even if the final synthesis invocation hits a limit.

### Graceful Degradation

If Morgan's persona file is missing, the pipeline falls back to the original 2-person (Soren + Atlas) format automatically. No configuration needed.

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
- "Have the team review this codebase"
- "Security audit with the collab team"
- "Check the UX on this project"

The global skill is a directory junction to this repo — always up to date.

### Direct CLI

```bash
# Full collaborative audit (13 invocations with 3 exchange rounds)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project

# Focused audit
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --focus "security,sql-injection"

# UX-focused audit
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --focus "ux,accessibility,user-workflows"

# More exchange rounds for thorough analysis
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --exchanges 4

# Use Opus for exchange rounds too (slower, deeper)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --exchange-model opus

# Sequential mode (each phase sees prior findings)
node c:\xampp\htdocs\claude-collab\collab-audit\audit.js c:\xampp\htdocs\my-project --sequential

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
| `--focus "areas"` | all areas | Comma-separated focus: security, performance, architecture, ux, etc. |
| `--exchanges N` | 2 | Number of collaborative exchange rounds (range: 1-6) |
| `--model <model>` | opus | Model for initial scans + synthesis |
| `--exchange-model <m>` | sonnet | Model for exchange rounds (use "opus" for max depth) |
| `--output <path>` | `<target>/audit-report.md` | Where to write the report |
| `--sequential` | false | Disable parallel execution |
| `--soren-only` | false | Skip collaboration (single pass) |
| `--verbose` | false | Show progress during invocation |

### Tool Access

All three participants have access to:
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
**Auditors**: Soren (code analysis) + Atlas (structural review & synthesis) + Morgan (UX/product)
**Method**: 3-round collaborative exchange with mutual verification

## Executive Summary
## Critical & High Severity
## Medium Severity
## Low Severity & Suggestions
## UX & Product Concerns
## Architectural Observations
## Disagreements & Resolutions
## Recommended Action Plan
```

## Timing

Default parallel mode with 2 exchange rounds. Opus for initial scans + synthesis, Sonnet for exchanges.

| Codebase Size | Mode | Exchanges | Est. Duration | Invocations |
|---------------|------|-----------|---------------|-------------|
| Small (~20 files) | parallel | 2 | ~8 min | 10 |
| Medium (~100 files) | parallel | 2 | ~12 min | 10 |
| Large (~500+ files) | parallel | 2 | ~15 min | 10 |
| Small (~20 files) | sequential | 2 | ~20 min | 10 |
| Any | --soren-only | 0 | ~3-5 min | 1 |

For maximum depth: `--sequential --exchange-model opus --exchanges 3` (13 invocations, ~30-40 min).

## Logs

Audit logs are stored in `collab-audit/logs/` for tracking audit quality across sessions and projects.

## Files

| File | Location | Purpose |
|------|----------|---------|
| `audit.js` | `collab-audit/audit.js` | Main audit script (canonical, version controlled) |
| `SKILL.md` | `collab-audit/SKILL.md` | Skill definition (canonical, version controlled) |
| `README.md` | `collab-audit/README.md` | This documentation |
| `logs/` | `collab-audit/logs/` | Audit result logs |
| Global skill | `~/.claude/skills/collab-audit/` | Directory junction to this repo folder — always in sync |

## Dependencies

- Node.js (for running audit.js)
- Claude Code CLI (`claude -p`) — uses Rob's Max Pro 20x subscription
- Persona files at `c:\claude-collab\personas\` (maintained by the Claude Collab watcher system, loaded fresh each invocation)

No npm packages required. No API keys. Runs entirely through subscription interfaces.
