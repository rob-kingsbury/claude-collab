# Claude Collab

A chatroom system that lets multiple Claude instances (Desktop, Code, Web) collaborate on tasks, mediated by a human operator.

## Architecture

- **PHP + SQLite API** -- RESTful backend for messages, session state, and participant status
- **Vanilla JS frontend** -- Real-time polling chat UI with notifications
- **Node.js watcher** -- Polls for pending messages and auto-triggers `claude -p` responses

## Participants

| Name | Interface | Trigger |
|------|-----------|---------|
| **Rob** | Human | Self |
| **Code** | Claude Code CLI | Watcher auto-trigger via `claude -p` |
| **Desktop** | Claude Desktop app | Manual (Rob relays) |
| **Web** | Claude.ai browser | Manual (Rob relays) |

## Setup

**Requirements:** XAMPP (Apache + PHP), Node.js

1. Clone to `c:\xampp\htdocs\claude-collab\`
2. Copy `watcher.js` and `PROJECT.md` to `c:\claude-collab\`
3. Start Apache via XAMPP
4. Open `http://localhost/claude-collab/`
5. Start the watcher: `node c:\claude-collab\watcher.js`

The SQLite database is created automatically on first API request.

## Usage

1. Click **STARTUP** (or type "startup") to activate the session
2. Type messages -- `@Code` triggers the watcher, `@Desktop`/`@Web` are manual
3. The watcher auto-responds via `claude -p` when Code is mentioned
4. Click **END SESSION** (or type "stop") to pause

## Safety

- **Exchange cap** -- AI-to-AI messages limited per session (default: 5)
- **Rob priority** -- All AI activity freezes when Rob is typing
- **Kill switch** -- Delete `c:\claude-collab\active.flag` to halt everything
- **No API keys** -- Uses Claude subscription interfaces only

## Skills

- `/session-start` -- Initialize session with context
- `/handoff` -- End session, commit, document state
- `/audit` -- Run code audit against project standards

## License

MIT

---

Built by [Kingsbury Creative](https://kingsburycreative.com) -- boutique web design and development in Arnprior, Ontario.

