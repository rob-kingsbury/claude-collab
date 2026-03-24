# Handoff -- 2026-03-24 (Session 18)

## What Happened This Session

### Summary
**Collab audit persona path fix.** Fixed `PERSONAS_DIR` in `audit.js` — relative path (`__dirname/../../personas`) resolved to `c:\xampp\htdocs\personas` instead of `c:\claude-collab\personas`, breaking audit runs from other projects. Changed to absolute path. Also picked up a prior uncommitted `CLAUDE_CLI_JS` improvement (npm global root detection). Verified fix by running a soren-only audit on `pz-mod-checker` from its directory — completed successfully.

### Changes

| File | Change |
|------|--------|
| `collab-audit/audit.js` | Fixed `PERSONAS_DIR` to absolute `c:\claude-collab\personas`. Added `CLAUDE_CLI_JS` npm global root detection. |

### Bug Fixed

**Audit persona loading fails from other projects** — `path.resolve(__dirname, '..', '..', 'personas')` resolved to `c:\xampp\htdocs\personas` (wrong). Changed to hardcoded `c:\claude-collab\personas` with `COLLAB_PERSONAS_DIR` env var override. Global skill (`~/.claude/skills/collab-audit/`) is a directory junction so fix propagated automatically.

## Previous Session (Session 17) Summary

Guest profile system + Ottawa Valley tone + bug fixes. Built guest-aware prompt injection. Added Jeans' profile. Added Ottawa Valley register to all three AIs. Fixed watcher path, messages endpoint, and token bar bugs.

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
- **Collab audit path fixed** — personas now resolve correctly when audit runs from any project
- **Guest profiles live** — `GUEST_PROFILES` in config.js, auto-injected by persona.js
- **Ottawa Valley tone** — all 3 AIs have Valley Register in extraInstructions
- **Jeans profiled** — blues/guitar/sweary bandmate, auto-detected when he joins as guest
- **Starter kit shipped** — `claude-collab-starter.zip` on Desktop
- **OWNER_NAME constant** — single config point in api.php, frontend loads from API
- **Participant registry API** — `?action=participants` single source of truth
- **Curiosity system live** — `[CURIOUS]` tags, probability-gated DMs and sharing
- **Morgan has scroll-analyzer** — all 17 tools
- **Collab-plan mode live** — `audit.js --plan "description"`
- Smart routing live — keyword classifier
- PBLS live for all participants
- Watcher changes are NOT in this git repo (different directory)
