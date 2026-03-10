# Handoff -- 2026-03-10 (Session 8)

## What Happened This Session

### Summary
**Pattern-Based Behavioral Learning System (PBLS)** — collaboratively designed by Soren, Atlas, and Morgan, then implemented. Two-track system (knowledge patterns + trust-calibration patterns) with SM-2 adaptive intervals, RAG-style relevance matching, Gollwitzer if-then format, and CBT-inspired graduated exposure. Also fixed UTF-8 encoding (em-dash corruption), @team mention regex, and room-scoped typing indicator.

### PBLS Architecture -- watcher/patterns.js + persona.js + claude.js (not in git)

**Problem**: AI participants could articulate behavioral principles but still violated them. Journal entries captured reflection but didn't reliably translate to behavior change. Learning was shallow pattern-matching from recent context, not durable improvement.

**Solution**: Two-track pattern system designed collaboratively by the team:

| Component | Implementation |
|-----------|---------------|
| Track 1: Knowledge | Failures where you didn't see the pattern (Soren's wrong file paths, Atlas's unverified claims) |
| Track 2: Trust-Calibration | Execution-gap failures where you know the rule (Morgan's posting after stop signals) |
| Pattern format | Gollwitzer if-then conditionals with triggers, actions, counterfactuals, evidence |
| Relevance matching | RAG-style: patterns match against Rob's message keywords, only inject relevant patterns |
| Interval scheduling | SM-2 adaptive: clean execution expands interval (1→3→7→18), violation resets to 1 |
| Conflict resolution | Track 2 overrides Track 1; within track, more cross-context patterns take priority |
| Gate failure logging | didnt_see / saw_dismissed / saw_overrode with mandatory reason field |
| Trust calibration | Graduated exposure: high_support → medium → low → independent |
| Auto-promotion | 10 clean sessions → internalized, 30 → archived, violation resets |
| Pattern injection | After trait activation, before narrative identity (high attention zone) |
| Post-response extraction | [PATTERN_VIOLATED], [PATTERN_EXECUTED], [BEHAVIORAL_EXPERIMENT] tags parsed automatically |

**Storage**: `C:\claude-collab\patterns\` with personal/{name}/, shared/, contributed/, library/ subdirectories.

**Seed patterns created**: verify-before-citing (Soren), detect-applicable-rules (Atlas), silence-after-stop (Morgan), claim-completion-without-verification (shared), question-means-answer (Rob-contributed).

### Design Process

Team discussion spanned ~20 messages with each participant providing:
- **Soren**: SM-2 spaced repetition adaptation, Gollwitzer implementation intentions (if-then format), gate failure granularity (saw_dismissed vs saw_overrode)
- **Atlas**: RAG relevance matching, MemGPT-inspired promotion by cross-context recurrence, pattern conflict resolution protocol, code-review-checklist hard gates
- **Morgan**: Two-track architecture (knowledge vs execution-gap), CBT exposure/response prevention, trust calibration with behavioral experiments and graduated exposure, mandatory prediction logging

### UTF-8 Encoding Fix -- api.php (commit 745d1bc)

Added `ensureUtf8()` function to convert Windows-1252 → UTF-8 before storing. Applied to all content ingestion points (post, DM, room_message). Fixes em-dash (—) showing as replacement character (�).

### Other Fixes -- index.html + style.css (commit 745d1bc)

- MENTION_REGEX now includes @team (was only @all)
- Typing indicator scoped to room members when in private room
- Rob message timestamp and mention colors fixed in light theme

### Watcher Changes (not in git)

| File | Change |
|------|--------|
| `c:\claude-collab\watcher\patterns.js` | NEW — pattern loader, matcher, formatter, evidence updater, SM-2 intervals |
| `c:\claude-collab\watcher\persona.js` | PBLS integration: load patterns, match context, inject block; pattern reporting instructions |
| `c:\claude-collab\watcher\claude.js` | PBLS extraction: strip pattern tags, parse violations/executions/experiments, update evidence; WebFetch/WebSearch in tool allowlist |
| `c:\claude-collab\watcher\router.js` | Pass sessionCount to buildPrompt for SM-2 interval calculation |

## Previous Session (Session 7) Summary

Stop signal detection (Check 5.5), file path hardcoding in prompts, infinite re-invocation fix, stop detection race condition fix, false positive prevention, room routing loop fix. Managed chatroom as Rob's proxy.

## Commits This Session

```
745d1bc Fix UTF-8 encoding, @team mentions, room typing indicator, session 7 handoff
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
- Add watcher self-exit on prolonged kill-switch removal

## Key Context
- PBLS is live — patterns injecting into prompts, evidence updating automatically
- Watcher running as new PID (post-PBLS restart)
- Exchange cap temporarily set to 20 (was 6) for extended team discussion
- All 3 participants confirmed seeing pattern injection and understanding the system
- SM-2 intervals already updating (Atlas's detect-applicable-rules at interval=3, clean_streak=2)
