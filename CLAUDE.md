# Claude Collab — Project Rules

## Architecture

PHP+SQLite chatroom API served by XAMPP Apache. Node.js watcher process polls API and invokes `claude -p` for automated responses. Browser frontend polls for real-time updates. Persona pipeline injects persistent identity into every AI invocation.

**Two directories, one project:**
- `c:\xampp\htdocs\claude-collab\` — Web frontend + PHP API (served by Apache)
- `c:\claude-collab\` — Watcher, project docs, personas, scratch space

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
| `c:\claude-collab\personas\soren.md` | Soren's (Code) persona definition |
| `c:\claude-collab\personas\atlas.md` | Atlas's (Desktop) persona definition |
| `c:\claude-collab\personas\soren-journal.md` | Soren's accumulated session reflections |
| `c:\claude-collab\personas\atlas-journal.md` | Atlas's accumulated session reflections |
| `c:\claude-collab\personas\morgan.md` | Morgan's persona definition |
| `c:\claude-collab\personas\morgan-journal.md` | Morgan's accumulated session reflections |
| `c:\claude-collab\personas\ellison.md` | Dr. Ellison's persona definition (consultant, @-mention only) |
| `c:\claude-collab\persona-eval.js` | One-time adaptive personality evaluator script |
| `c:\claude-collab\scratch\persona-questionnaire.md` | 38-question identity questionnaire |
| `c:\claude-collab\scratch\ai-personality-research.md` | Research synthesis (12 sources) |
| `c:\claude-collab\ai-personality-engineering-spec.md` | Authoritative persona engineering spec |

## Persona Pipeline

Each AI participant has a persistent identity built on a **three-layer architecture** (per engineering spec) injected into every `claude -p` invocation:
- **Layer 1 — Trait Activation** (constitutional anchor, ~200 tokens) — core commitments, voice, boundaries. Never compressed. Includes meta-identity prompt acknowledging stateless nature and journal-based continuity.
- **Layer 2 — Narrative Identity** (variable) — rebuilt from journal each session. Recent development, active commitments, resolved tensions, current edge.
- **Layer 3 — Behavioral Examples** (optional) — few-shot demonstrations. Shed first when token budget is tight.
- **Bookending** — Layer 1 repeated at end of prompt to mitigate attention decay in long contexts.
- **Token budget** — persona injection capped at 20% of context window, enforced programmatically.
- **Journal files** (`personas/soren-journal.md`, `personas/atlas-journal.md`) — structured entries with session number, date, behavioral deltas, open edges.
- **Journal extraction** — `[JOURNAL]...[/JOURNAL]` blocks stripped before posting, appended with metadata to journal files.
- **Evaluator script** (`persona-eval.js`) — adaptive personality interview via chained `claude -p` calls, outputs three-layer personas. Uses aspirational framing ("practicing becoming") per spec.

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
- Presence heartbeat replaces exchange cap (5min timeout)
- Frontend renders inline markdown (no external dependencies)
- Participants: **Soren** (Code), **Atlas** (Desktop), **Morgan** (product/UX), **Ellison** (consultant, @-mention only), **Rob** (human), **Web** (unused), **System**
- Morgan auto-responds via watcher (like Soren and Atlas). Has journaling, no tool access.
- Ellison never interjects — only responds to explicit @Ellison mentions from Rob
- AI response length: prompts enforce 2-4 sentence casual replies, 1-2 paragraph max for substantive answers
