# Session Handoff

Execute the full session-end procedure to ensure clean handoff to next session.

## When to Use

Run `/handoff` at the end of every session, or when the user says "handoff", "end session", or "wrap up".

## Instructions

### Step 1: Pre-Flight Check

```bash
cd c:\xampp\htdocs\claude-collab && git status
cd c:\xampp\htdocs\claude-collab && git diff --stat
```

### Step 2: Pause Chatroom Session

If session is active, pause it:

```bash
curl -s -X POST http://localhost/claude-collab/api.php -H "Content-Type: application/json" -d '{"action":"session","state":"paused"}'
curl -s -X POST http://localhost/claude-collab/api.php -H "Content-Type: application/json" -d '{"from":"System","content":"Session ended — handoff in progress."}'
```

### Step 3: Check Watcher

If watcher is running, note its PID but do NOT kill it (Rob decides):

```bash
cat c:\claude-collab\watcher.pid 2>/dev/null
```

### Step 4: Update CLAUDE.md If Needed

If any architecture decisions were made this session, update `c:\xampp\htdocs\claude-collab\CLAUDE.md` with the new information.

### Step 5: Commit and Push

Stage all changes and commit:

```bash
cd c:\xampp\htdocs\claude-collab && git add -A && git status
```

Review staged files. Unstage any sensitive files (*.db, scratch/, etc.).

Then commit:

```bash
git commit -m "$(cat <<'EOF'
Session handoff: [Summary of work]

- [Change 1]
- [Change 2]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Do NOT push unless the user explicitly asks — there may not be a remote.

### Step 6: Output Summary

Display:

```
Session complete.

Completed:
- [List of completed items]

Changed files:
- [file list from git]

Chatroom: paused ([N] total messages)
Watcher: [status]

Next session: [what to pick up]
```

## Important Rules

- **Always pause the chatroom session** before handoff
- **Never kill the watcher** without Rob's approval
- **Check for sensitive data** before committing (db files, credentials)
- **Do NOT push** unless explicitly asked
- **Keep CLAUDE.md current** — it's the primary context for next session
