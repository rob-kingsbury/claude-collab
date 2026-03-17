# Handoff -- 2026-03-17 (Session 16)

## What Happened This Session

### Summary
**Starter kit packaging + audit-driven codebase cleanup.** Ran a collab audit focused on security/PII, accuracy, and cold-install readiness. Fixed 16 findings (2 high, 11 medium, 3 low). Removed ~200 lines of dead DM code, added batch reactions endpoint, migration caching, configurable owner name, API-served participant registry, and parameterized paths. Built and zipped a starter kit (`claude-collab-starter.zip`) for sharing with a student — includes all code, example personas, Ellison facilitator, docs, and a setup README.

### Changes (git-tracked)

| File | Change |
|------|--------|
| `api.php` | OWNER_NAME constant, schema_version migration cache, batch reactions endpoint, `?action=participants` endpoint, removed DM code (~200 lines), parameterized watcher path, removed client-controlled override_cap, race-safe reaction toggle, SQL parameterization in history, `room_id` in initDb, dynamic participant status defaults |
| `index.html` | Frontend loads participants from API (`loadParticipants()`), `ownerName` variable replaces hardcoded 'Rob', batch reaction sync (1 request instead of 30), session auto-start respects `session_ended_explicitly`, removed SME, dynamic `knownSenders` from API |
| `collab-audit/audit.js` | Parameterized `CLAUDE_CLI_JS` and `PERSONAS_DIR` via env vars with resolved defaults |
| `uploads/.htaccess` | Fixed Apache 2.2→2.4 syntax (`Require all granted`) — prevents silent cold-install file-serving break |
| `seed-db.php` | Removed hardcoded participant names, generic seed messages |
| `messages.example.json` | **Deleted** — vestigial flat-file format |
| `read-messages.php` | **Deleted** — dead debug utility with hardcoded absolute path |

### Audit Results (Session 16)

Full collab audit (Soren + Atlas + Morgan, 10 invocations, 8.4 min). 0 critical, 2 high, 11 medium, 17 low findings.

**Fixed this session:**
- M1: Migration runs every request → schema_version cache
- M2: N+1 reaction sync (30 HTTP requests/10s) → single batch endpoint
- M3: Mixed Apache .htaccess syntax → Apache 2.4 throughout
- M4: Session auto-start ignores explicit end → checks `session_ended_explicitly`
- M6: Hardcoded watcher path → env var with default
- M7: Hardcoded paths in audit.js → env vars with resolved defaults
- M8: Client-controlled override_cap → server-side limit only
- M9: Participant registry triplicated → API endpoint, frontend loads from API
- M10: No configuration mechanism → OWNER_NAME constant, env vars, API-served config
- M11: Silent popen watcher start → script existence check + heartbeat verification
- L1: SQL string interpolation in history → parameterized queries
- L3: Reaction toggle race condition → INSERT-or-catch-DELETE
- L5: Dead DM code → removed (~200 lines)
- L6: Vestigial JSON files → deleted
- L7: Stale name in seed-db → generic messages
- L9: Dead read-messages.php → deleted
- Cold-install bug: `room_id` column missing from `initDb()` CREATE TABLE → added

**Still open (not fixed):**
- H1: No authentication (architectural — localhost-only by design)
- H2: Mobile sidebar inaccessible (needs hamburger toggle)
- M5/N2: Room management endpoints have no authorization
- L2: Underscore in participant names (low risk)
- L4: Client-supplied MIME type used as primary
- L8: /mute and /unmute registered but not implemented
- L10: Schema defined twice in initDb + migrateDb
- L11: Mention parsing duplicated between lobby and room handlers
- L12: Full session_state dump every 2s poll
- L13: 3 separate HTTP fetches per 2s poll (combine into ?action=poll)
- L14: Inconsistent error handling across endpoints

### Starter Kit

Built `claude-collab-starter.zip` (151 KB, 37 files) on Desktop for email distribution. Contains:
- Full web frontend + watcher engine with parameterized paths
- Example personas (Soren, Atlas, Morgan) + Ellison facilitator
- Empty journal stubs, PBLS framework with example patterns
- Personality engineering spec, questionnaire, design system docs
- README with setup instructions (no emojis)

**Excluded:** All journal content, evaluation transcripts, database, scratch files, user uploads, SME participant, session-specific docs.

**Key config points for recipient:**
1. `OWNER_NAME` in `web/api.php` — change from 'Rob'
2. `API_BASE` in `watcher/config.js` — verify Apache URL
3. Watcher modules still reference 'Rob' in functional code — needs find/replace if owner name changes
4. Participant names change after Ellison evaluation — update config.js PARTICIPANTS + api.php constants

## Previous Session (Session 15) Summary

Extended Ellison personality session + curiosity system + emoji AI integration. Humor registers developed, behavioral directives codified, new personality traits chosen. Built curiosity/autonomous learning module. Verified emoji/reaction system end-to-end.

## Active Issues
- **GitHub Issue #1**: /commands for chatroom control (partially implemented)
- **Knowledge graph**: v3 extraction validated but not wired into watcher startup prompts

## Remaining Audit Findings (Unfixed)

### High
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle

### Medium
- **M5/N2**: Room management endpoints have no authorization
- **S1**: No authentication; verify Apache binds to 127.0.0.1 only

### Low
- L2, L4, L8, L10-L14 (see audit results above)

## Pending Work
- **BandPilot OG social card** (1200x630 landscape) — deferred
- Test curiosity system live
- Test collab-plan mode live run
- Test Morgan's scroll-analyzer with a real URL
- Session-close synthesis script (compress raw journal → pattern updates)
- Wire knowledge graph into watcher startup prompts
- GitHub Issue #1: /commands for chatroom control
- Stability testing harness (spec S6)
- message-box/ folder for Soren/Atlas/Morgan feedback
- Combine 3 poll endpoints into single `?action=poll`
- Mobile sidebar (hamburger toggle)
- Consolidate schema duplication (initDb + migrateDb)
- Watcher owner name: parameterize 'Rob' references in router.js, persona.js, curiosity.js

## Key Context
- **Starter kit shipped** — `claude-collab-starter.zip` on Desktop, ready to email
- **OWNER_NAME constant** — single config point in api.php, frontend loads dynamically from API
- **Participant registry API** — `?action=participants` is now the single source of truth
- **Batch reactions** — 1 HTTP request instead of 30 per sync cycle
- **Migration cache** — schema_version check skips ~15 DDL statements per request
- **DM code removed** — conversations/dm_messages tables, endpoints, helpers all deleted
- **SME participant removed** — stripped from registries
- **Curiosity system live** — `[CURIOUS]` tags, probability-gated DMs and sharing
- **Emoji/reaction AI integration** — batch endpoint, race-safe toggle
- **Morgan has scroll-analyzer** — all 17 tools
- **Collab-plan mode live** — `audit.js --plan "description"`
- Smart routing live — keyword classifier
- Exchange cap at 6 (was 8)
- PBLS live for all participants
- Heartbeat API: POST body `{"action":"heartbeat","focused":true}` (not query string)
