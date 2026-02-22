# Session Start

Initialize a new working session with full project context.

## When to Use

Run `/session-start` at the beginning of every session, or when you need to refresh context.

## Instructions

### Step 1: Read Context Files

Read these files in parallel:

```
c:\xampp\htdocs\claude-collab\CLAUDE.md           # Project rules, architecture
c:\claude-collab\PROJECT.md                        # Collab directives, participant docs
```

### Step 2: Check Chatroom State

```bash
curl -s http://localhost/claude-collab/api.php?action=state
curl -s "http://localhost/claude-collab/api.php?action=messages&limit=5" | python -c "import sys,json; msgs=json.load(sys.stdin).get('messages',[]); [print(f'[{m[\"participant\"]}] {m[\"content\"][:80]}') for m in msgs[-5:]]"
```

### Step 3: Check Watcher Status

```bash
# Is watcher running?
cat c:\claude-collab\watcher.pid 2>/dev/null && tasklist | findstr /V "grep" | findstr node || echo "Watcher not running"

# Recent watcher activity
tail -10 c:\claude-collab\scratch\watcher.log 2>/dev/null || echo "No watcher log"
```

### Step 4: Check Git Status

```bash
cd c:\xampp\htdocs\claude-collab && git status && git log --oneline -5
```

### Step 5: Output Confirmation

Display:

```
Claude Collab ready.
Session: [active/paused] | Messages: [N] | Exchanges: [X/cap]
Watcher: [running PID X / not running]
Last commit: [hash] [message]
Last 3 messages:
  [participant]: [content preview]
```

## After Session Start

Do NOT begin work until the user confirms what to focus on.
