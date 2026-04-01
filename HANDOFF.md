# Handoff -- 2026-04-01 (Session 20)

## What Happened This Session

### Summary
**Knowledge graph: injection + automated extraction.** Wired knowledge graph into watcher prompts — `loadKnowledgeGraph()` in persona.js reads graph JSON and injects a `=== SESSION LANDSCAPE ===` block (~450 tokens) into every AI participant's prompt. Built automated extraction in `watcher/graph.js` — fires on inactivity auto-close, invokes `claude -p` (Sonnet) to extract semantic graph from session messages, validates JSON, backs up old graph. Also fixed collab audit bugs: persona path resolution and added `--only` flag for participant selection.

### Changes

**git-tracked (claude-collab web root):**

| File | Change |
|------|--------|
| `collab-audit/audit.js` | Fixed `PERSONAS_DIR` to absolute path. Added `--only` flag. Added CLI npm global root detection. |
| `collab-audit/SKILL.md` | Documented `--only` flag with examples. |
| `collab-audit/README.md` | Documented `--only` flag. |

**NOT git-tracked (c:\claude-collab\ watcher directory):**

| File | Change |
|------|--------|
| `watcher/graph.js` | **NEW** — automated knowledge graph extraction (session-close trigger, claude -p invocation, JSON validation, backup) |
| `watcher/persona.js` | Added `loadKnowledgeGraph()` — reads graph JSON, formats compact text block, injects into `buildPrompt()` as `=== SESSION LANDSCAPE ===` |
| `watcher/config.js` | Added `KNOWLEDGE_GRAPH_FILE` path constant |
| `watcher.js` | Import graph module. Fire `extractKnowledgeGraph()` on inactivity auto-close before session close. |

## Previous Session (Session 19) Summary

Collab audit fixes: persona path + participant selection. Fixed `PERSONAS_DIR` relative path. Added `--only` flag for participant selection. Updated SKILL.md and README.md.

## Active Issues
- **GitHub Issue #1**: /commands for chatroom control (partially implemented)
- **GitHub Issue #6**: Knowledge graph — injection + auto-extraction done, incremental improvements pending (manual End Session trigger, cross-session merge, quality monitoring)

## Remaining Audit Findings (Unfixed)

### High
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle

### Medium
- **M5/N2**: Room management endpoints have no authorization

### Low
- L2, L4, L8, L10-L14 (see session 16 handoff in git history)

## Pending Work
- Test knowledge graph extraction live (trigger an inactivity close, verify graph updates)
- Add graph extraction on manual "End Session" button (currently only fires on inactivity auto-close)
- Test curiosity system live
- Test collab-plan mode live run
- Test Morgan's scroll-analyzer with a real URL
- GitHub Issue #1: /commands for chatroom control
- Combine 3 poll endpoints into single `?action=poll`
- Mobile sidebar (hamburger toggle)
- Consolidate schema duplication (initDb + migrateDb)
- Watcher owner name: parameterize 'Rob' references in router.js, persona.js, curiosity.js
- message-box/ folder for Soren/Atlas/Morgan feedback
- Stability testing harness (spec S6)
- BandPilot OG social card (deferred)

## Key Context
- **Knowledge graph live** — injection in prompts + automated extraction on session-close
- **Graph file**: `c:\claude-collab\scratch\session-graph-output.json` (backup: `-backup.json`)
- **Extraction uses Sonnet** — single turn, 3min timeout, fire-and-forget
- **Current graph is stale** (session 4) — will auto-update on next inactivity close
- **`--only` flag live** — select any combo of soren/atlas/morgan for audits
- **Collab audit path fixed** — personas resolve correctly from any project
- **Global skill is a junction** — `~/.claude/skills/collab-audit/` → repo's `collab-audit/`
- Watcher changes are NOT in this git repo (different directory)
