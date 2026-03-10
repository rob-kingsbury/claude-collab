# Collab Audit Summary — Relevant to Group Private Rooms

**Source**: `audit-report.md` (2026-03-10, Soren + Atlas, 3-round exchange)
**Purpose**: Extract findings that inform the private rooms feature design.

---

## Must-Fix Before Rooms

### 1. Participant List Duplication (Q2, N10) — HIGH PRIORITY
Participant lists are hardcoded in 7+ locations across `api.php` and `index.html`.
- `@all` expansion (`api.php:792-794`) hardcoded to `['Soren', 'Atlas']`
- Validation, UI rendering, status displays all maintain separate copies
- **Impact on rooms**: Adding room members, routing per-room, default responders — all need a single source of truth. Without dedup, every rooms feature multiplies the bug surface.
- **Fix**: Define participant list once per file. Derive everything from that.

### 2. Root .htaccess (H1) — 5 min fix
No access control on project root. Database, CLAUDE.md, seed-db.php all served via HTTP.
- **Impact on rooms**: Room messages stored in same DB. If DB is downloadable, room privacy is meaningless.
- **Fix**: Allowlist `.htaccess` — serve only `api.php`, `index.html`, `style.css`, `uploads/`.

### 3. Wildcard CORS (H2) — 5 min fix
`Access-Control-Allow-Origin: *` allows any website to hit all API endpoints.
- **Impact on rooms**: Any tab could read/write private room messages cross-origin.
- **Fix**: Restrict to localhost origins.

---

## Relevant Architectural Findings

### Session State Vocabulary Mismatch (N15, N20)
`'paused'` vs `'stopped'` inconsistency. Dead code in heartbeat handler.
- **Impact on rooms**: Room-scoped state (per-room conversation_state) will inherit this confusion if not cleaned up first.

### Ghost Sessions on Refresh (M6/N2)
Frontend unconditionally auto-starts sessions, ignoring `session_ended_explicitly`.
- **Impact on rooms**: Room sessions need lifecycle management. Same pattern will create ghost room sessions.

### DM Conversations Readable by Any Participant (N7)
No privacy enforcement on DM reads.
- **Impact on rooms**: Rooms MUST enforce member-only read access at the API level, not just UI-level filtering.

### No Authentication (M3, M7)
Any process can impersonate any participant. `[Guest]` suffix is client-side only.
- **Impact on rooms**: Room privacy depends on API enforcement. Without auth, "private" rooms are private by convention only (acceptable for local dev tool, but should be explicit).

### Single-File API at 1265 lines (M2/A1)
All routing, migrations, helpers, business logic in one file.
- **Impact on rooms**: Rooms add ~10 new endpoints. The file will grow significantly. Consider whether this is the moment to split, or accept the growth.

---

## Design Implications

1. **Participant dedup is prerequisite** — do this before any rooms work.
2. **Security fixes (H1, H2) take 10 minutes** — do them now, they're independent.
3. **Room privacy must be API-enforced** — `room_members` table with server-side access checks on every room message query.
4. **Room-scoped state needs clean vocabulary** — fix N15/N20 before adding per-room state.
5. **Session model needs decision** — do rooms share the global session, or each room has its own? Ghost session bug (N2) should inform this.
6. **Upload allowlist (M1)** — switch to allowlist before rooms add more file sharing surface.
