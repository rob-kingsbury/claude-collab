# Handoff -- 2026-03-11 (Session 11)

## What Happened This Session

### Summary
**Watcher self-stopping bug fixed.** Two bugs in `router.js` / `claude.js` caused the watcher to stop routing after Rob went inactive, requiring a manual session restart each time.

### Bug 1: Check 4 killed the session on heartbeat timeout (primary)

| Detail | |
|--------|-|
| **Root cause** | Check 4 in `robPriorityCheck` called `apiPost({ action: 'session', state: 'paused' })` when Rob's heartbeat went stale. `api.php:1162` maps `state: 'paused'` → `session_active=false`. |
| **Effect** | On the very next poll cycle, Check 3 ("Session must be active") blocked. Watcher stuck at "Gate: Session not active" indefinitely until Rob manually clicked Start Session. |
| **Dead code** | The `conversation_state !== 'paused'` guard was never true (that field is only `'active'` or `'stopped'`), so the session-killing call fired every poll cycle Rob was absent. |
| **Fix** | Removed the 3-line block entirely. Check 4 now just returns `{ pass: false }` without touching state. When Rob's heartbeat is fresh again, the gate passes automatically. |

### Bug 2: Exit code 1 failures created tight retry loop (secondary)

| Detail | |
|--------|-|
| **Root cause** | When `invokeClaude` threw (claude -p exit code 1), `lastRoutedId` wasn't advanced. Same message triggered a new invocation every 3 seconds — potentially compounding whatever caused the original failure. |
| **Fix** | Added 30-second failure cooldown per participant (`lastInvocationFailure` map in `router.js`). Cleared on success. Retries every 30s instead of every 3s. |
| **Diagnostic improvement** | `claude.js` error message now includes stderr content: `Exit code 1: <stderr>` instead of just `Exit code 1`. |

### Files Changed (not in git — watcher directory)

- `c:\claude-collab\watcher\router.js` — Check 4 simplified, failure cooldown added
- `c:\claude-collab\watcher\claude.js` — exit code error message improved

## Previous Session (Session 10) Summary

Collab-audit 3-person pipeline + speed optimizations + global skill sync. Added Morgan as third auditor. Parallel execution (initial scans + exchange rounds). Model tiering (Opus for initial+synthesis, Sonnet for exchanges). Reduced default exchanges 3→2. Replaced global skill copy with Windows directory junction.

## Commits This Session

```
(pending — HANDOFF.md only; watcher fixes not in git)
```

## Active Issues
- **GitHub Issue #1**: /commands for chatroom control (partially implemented)
- **Knowledge graph**: v3 extraction validated but not wired into watcher startup prompts

## Remaining Audit Findings (Unfixed)

### Medium
- **N2**: Room management endpoints have no authorization
- **S1**: No authentication; verify Apache binds to 127.0.0.1 only
- **P1/P2**: Migration runs on every request; add schema_version cache

## Pending Work
- Session-close synthesis script (compress raw journal → pattern updates)
- Wire knowledge graph into watcher startup prompts
- GitHub Issue #1: /commands for chatroom control
- Stability testing harness (spec S6)
- message-box/ folder for Soren/Atlas/Morgan feedback
- Persist reactions to DB
- Serve participant list from API (single source of truth)
- Combine 3 poll endpoints into single `?action=poll`
- Remove dead DM code (~200 lines in api.php)

## Key Context
- Watcher self-stopping bug fixed (session 11) — watcher no longer kills session on Rob heartbeat timeout
- Smart routing live — keyword classifier routing unaddressed messages
- Exchange cap at 8
- Conversational tone guidelines live in config + persona files
- CLAUDECODE env var stripped from child processes (2.1.72 fix)
- Global /session-start and /handoff skills available across all projects
- Kill-switch self-exit working (3 consecutive misses → graceful shutdown)
- **Global collab-audit skill is a directory junction** — changes to repo auto-propagate
- **Collab-audit pipeline is now 3-person** — Soren (code) → Atlas (architecture) → Morgan (UX) → 3-way exchange → Atlas synthesis
- **Focus-based routing** in SKILL.md steers all auditors toward the right domain
