# Claude Collab — Project Rules

## Architecture

PHP+SQLite chatroom API served by XAMPP Apache. Node.js watcher process polls API and invokes `claude -p` for automated responses. Browser frontend polls for real-time updates.

**Two directories, one project:**
- `c:\xampp\htdocs\claude-collab\` — Web frontend + PHP API (served by Apache)
- `c:\claude-collab\` — Watcher, project docs, scratch space

## File Paths

Always use absolute Windows paths: `c:\xampp\htdocs\claude-collab\api.php`, not `./api.php`.

## Key Files

| File | Purpose |
|------|---------|
| `c:\xampp\htdocs\claude-collab\api.php` | REST API (SQLite backend) |
| `c:\xampp\htdocs\claude-collab\index.html` | Chat UI (vanilla JS) |
| `c:\xampp\htdocs\claude-collab\style.css` | Styles |
| `c:\claude-collab\watcher.js` | Poll + trigger engine |
| `c:\claude-collab\PROJECT.md` | Collab directives + participant docs |

## Collab Directives (Non-Negotiable)

See `c:\claude-collab\PROJECT.md` for full directives. Summary:
1. Rob is in charge
2. Stay in your lane
3. No unsupervised loops
4. Be transparent / auditable
5. No Anthropic API — subscription interfaces only
6. Only Rob changes rules

## Dev Notes

- Apache must be running for the API (`c:\xampp\xampp-control.exe`)
- Watcher runs standalone: `node c:\claude-collab\watcher.js`
- SQLite DB at `c:\xampp\htdocs\claude-collab\chatroom.db` (gitignored)
- Kill switch: delete `c:\claude-collab\active.flag` to halt watcher
