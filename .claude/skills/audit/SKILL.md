# Audit

Audit Claude Collab code against project standards: security, reliability, architecture, and collab safety.

## Target

Audit the file or component specified. If no argument, audit all three main files:
- `c:\xampp\htdocs\claude-collab\api.php`
- `c:\xampp\htdocs\claude-collab\index.html`
- `c:\claude-collab\watcher.js`

## Audit Types

| Type | Command | What It Checks |
|------|---------|----------------|
| Full | `/audit` | All categories |
| Security | `/audit security` | XSS, injection, auth |
| Watcher | `/audit watcher` | Reliability, race conditions, error handling |
| API | `/audit api` | PHP backend correctness |
| Frontend | `/audit frontend` | UI bugs, polling, notifications |

## Audit Categories

### 1. Security (CRITICAL)

**XSS:**
- [ ] All user content escaped before innerHTML
- [ ] `escapeHtml()` used for sender, content, mentions, status
- [ ] No raw API values injected into DOM attributes
- [ ] Participant status values sanitized

**SQL Injection:**
- [ ] All queries use prepared statements with `?` placeholders
- [ ] No string concatenation in SQL (except LIKE with allowlisted values)

**Input Validation:**
- [ ] `$from` validated against allowlist
- [ ] `$action` validated against known actions
- [ ] Participant names validated against allowlist

### 2. Watcher Reliability

**Concurrency:**
- [ ] PID file checked on startup (no duplicate instances)
- [ ] `codeInvoking` flag prevents concurrent `claude -p` calls
- [ ] `polling` flag prevents overlapping poll cycles

**Fetch Resilience:**
- [ ] `AbortSignal.timeout` on all fetch calls
- [ ] Retry logic with backoff
- [ ] HTTP status checked before parsing JSON
- [ ] Non-JSON responses caught and logged

**Process Management:**
- [ ] Spawn timeout cleared on normal completion
- [ ] `settled` flag prevents double promise resolution
- [ ] Graceful shutdown kills child processes
- [ ] PID file cleaned up on exit

**Data Integrity:**
- [ ] Response posted BEFORE marking messages as read
- [ ] `lastRoutedId` persisted across restarts
- [ ] Session state re-checked after long `claude -p` runs

### 3. API Correctness

**SQLite:**
- [ ] `PRAGMA busy_timeout` set (concurrent access)
- [ ] `PRAGMA journal_mode=WAL` (concurrent reads)
- [ ] Transactions for read-modify-write operations
- [ ] Atomic counter increments

**Session Keywords:**
- [ ] Only trigger when message IS the keyword (not substring)
- [ ] Trailing punctuation stripped before matching

**JSON Decode:**
- [ ] Using `?? []` not `?: []` (preserves empty arrays)

### 4. Frontend

**Polling:**
- [ ] `visibilitychange` handler for background tab catch-up
- [ ] `isPolling` guard prevents overlapping requests
- [ ] Null check on `data.messages` before `.length`

**UX:**
- [ ] Auto-scroll only when user is near bottom
- [ ] Typing indicator throttled (not every keystroke)
- [ ] Flash title timeout properly cleaned up
- [ ] Notifications only fire for other participants' messages

### 5. Collab Safety

**Directive Compliance:**
- [ ] Exchange cap enforced
- [ ] Rob typing freezes all AI activity
- [ ] Kill switch (`active.flag`) checked every cycle
- [ ] `--allowedTools ''` disables tool use in `claude -p`
- [ ] `--max-turns 1` limits response to single turn
- [ ] Session state respected (no posting when paused)

## Output Format

```markdown
## Audit: [target]

**Files Reviewed:**
- [path 1]

### Findings

| Category | Status | Issues |
|----------|--------|--------|
| Security | PASS/FAIL | [details] |
| Watcher Reliability | PASS/FAIL | [details] |
| API Correctness | PASS/FAIL | [details] |
| Frontend | PASS/FAIL | [details] |
| Collab Safety | PASS/FAIL | [details] |

### Critical Issues (Fix Immediately)
1. [Issue with file:line reference]

### Required Fixes
1. [Fix 1]

### Recommended Improvements
1. [Improvement 1]
```

## After Audit

If fixes are needed, ask user if they want to:
1. Fix issues now
2. Note them for later
3. Just document findings
