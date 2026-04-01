# Handoff -- 2026-04-01 (Session 19)

## What Happened This Session

### Summary
**Collab audit fixes: persona path + participant selection.** Fixed `PERSONAS_DIR` in `audit.js` — relative path resolved wrong when audit runs from other projects. Added `--only` flag for participant selection (e.g., `--only "morgan,atlas"`). Verified all combos work: solo participants, pairs, invalid names rejected. Updated SKILL.md and README.md with `--only` docs.

### Changes

| File | Change |
|------|--------|
| `collab-audit/audit.js` | Fixed `PERSONAS_DIR` to absolute `c:\claude-collab\personas`. Added `CLAUDE_CLI_JS` npm global root detection. Added `--only` flag for participant subset selection. |
| `collab-audit/SKILL.md` | Documented `--only` flag with examples. |
| `collab-audit/README.md` | Documented `--only` flag. |

## Previous Session (Session 18) Summary

Collab audit persona path fix. Fixed `PERSONAS_DIR` relative path that broke audit runs from other projects. Added `CLAUDE_CLI_JS` npm global root detection. Verified fix via soren-only audit on pz-mod-checker.

## Active Issues
- **GitHub Issue #1**: /commands for chatroom control (partially implemented)
- **Knowledge graph**: v3 extraction validated but not wired into watcher startup prompts

## Remaining Audit Findings (Unfixed)

### High
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle

### Medium
- **M5/N2**: Room management endpoints have no authorization

### Low
- L2, L4, L8, L10-L14 (see session 16 handoff in git history)

## Pending Work
- Test curiosity system live
- Test collab-plan mode live run
- Test Morgan's scroll-analyzer with a real URL
- Wire knowledge graph into watcher startup prompts
- GitHub Issue #1: /commands for chatroom control
- Combine 3 poll endpoints into single `?action=poll`
- Mobile sidebar (hamburger toggle)
- Consolidate schema duplication (initDb + migrateDb)
- Watcher owner name: parameterize 'Rob' references in router.js, persona.js, curiosity.js
- message-box/ folder for Soren/Atlas/Morgan feedback
- Stability testing harness (spec S6)
- BandPilot OG social card (deferred)

## Key Context
- **`--only` flag live** — select any combo of soren/atlas/morgan for audits
- **Collab audit path fixed** — personas now resolve correctly when audit runs from any project
- **Global skill is a junction** — `~/.claude/skills/collab-audit/` → repo's `collab-audit/`, always in sync
- **Guest profiles live** — `GUEST_PROFILES` in config.js, auto-injected by persona.js
- **Ottawa Valley tone** — all 3 AIs have Valley Register in extraInstructions
- **Collab-plan mode live** — `audit.js --plan "description"`
- Smart routing live — keyword classifier
- PBLS live for all participants
- Watcher changes are NOT in this git repo (different directory)
