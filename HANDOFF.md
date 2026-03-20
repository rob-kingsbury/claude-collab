# Handoff -- 2026-03-19 (Session 17)

## What Happened This Session

### Summary
**Guest profile system + Ottawa Valley tone + bug fixes.** Built guest-aware prompt injection (auto-detects `[Guest]` senders, injects profiles from config). Added Jeans' profile (blues/guitar/sweary bandmate). Added Ottawa Valley register to all three AI participants' extraInstructions. Fixed three bugs: watcher path wrong (couldn't start from UI), messages endpoint returning all history when no active session, and watcher start path defaulting to wrong directory.

### Changes

**git-tracked (claude-collab web root):**

| File | Change |
|------|--------|
| `api.php` | Fixed watcher script default path (`C:\claude-collab\watcher.js`). Fixed messages endpoint returning all history when no active session (`1=0` guard). |

**NOT git-tracked (c:\claude-collab\ watcher directory):**

| File | Change |
|------|--------|
| `watcher/config.js` | Added `GUEST_PROFILES` config (Jeans, S). Added Valley Register directive to Soren, Atlas, Morgan extraInstructions. |
| `watcher/persona.js` | Guest detection in `buildPrompt()` — scans pendingMessages for `[Guest]` senders, injects matching profiles from config. Imported `GUEST_PROFILES` from config. |

### Guest Profile System

- `GUEST_PROFILES` in `config.js` — keyed by lowercase name before `[Guest]` suffix
- Auto-detected in `buildPrompt()` when pending messages contain `[Guest]` senders
- Injected as `=== GUEST CONTEXT ===` block after extraInstructions
- Unknown guests get generic "be welcoming" fallback
- Current profiles: **Jeans** (blues/guitar bandmate, sweary, Ottawa Valley), **S** (Rob's partner)

### Ottawa Valley Register

Added to all three AI participants' `extraInstructions`:
- Direct, sweary, no-bullshit, dry humor
- "eh", "bud/buds", "give'er", "get'er done" sprinkled naturally
- Profanity as punctuation, not aggression
- Match energy — if they're loose and sweary, be too

### Bugs Fixed

1. **Watcher won't start from UI** — default path `__DIR__ . '/../watcher/watcher.js'` resolved to wrong directory. Changed to absolute `C:\claude-collab\watcher.js`.
2. **All history shown when no session active** — `getCurrentSessionId()` returning null meant no session filter was applied, dumping every message. Added `1=0` guard.
3. **Token bars full / can't hide history** — same root cause as #2. No session = all messages loaded = token counters maxed.

## Previous Session (Session 16) Summary

Starter kit packaging + audit-driven codebase cleanup. Ran collab audit, fixed 16 findings. Removed ~200 lines dead DM code. Built claude-collab-starter.zip (151 KB) for distribution.

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
