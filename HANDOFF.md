# Handoff -- 2026-04-29 (Session 24)

## What Happened This Session

### Summary
**Crob integration shipped to chatroom — hybrid memory live.** Built `watcher/crob.js` as the bridge between the watcher and Crob's data files (`crob.crob`, `crob.queue`, `crob.provenance.json`). Wired three layers: (1) shared knowledge injection — `=== CROB KNOWLEDGE ===` block surfaces facts on topics extracted from pending Rob messages, with HIGH/MED/LOW tier and source attribution; (2) per-persona threads — `scratch/{name}-tangents.json` tracks each persona's open `[TANGENT]` threads + their contributed facts via provenance attribution; (3) confidence discipline — prompt teaches AIs to prefix factual/speculative claims with `[HIGH]`/`[MED]`/`[LOW]` (visible to Rob, not stripped). New tags: `[TANGENT: topic | reason | priority]` queues research, `[CROB_LEARN: subj | rel | obj | conf | source]` persists facts. Pipeline integrated in `claude.js` between curiosity completion and design prefs. Crob's PHP loader confirmed compatible with files written from Node. Then ran collab-audit on the changes — 5 HIGH, 7 MED, 9 LOW. Fixed all HIGH + 5/7 MED + 3/9 LOW (see "Fixes Shipped" below). Skipped 3 enhancement-class MEDs (queued as #12/#13/#14) and cosmetic LOWs.

### Fixes Shipped (from audit)
- **H1**: pipe-split parsing reconstructs trailing fields with `slice().join('|')` so URLs with `?a=1|b=2` query strings survive intact
- **H2/UX1**: prompt instruction added — AIs not to use `]` inside `[TANGENT]`/`[CROB_LEARN]` tags (durable parser fix deferred)
- **H3**: `learn()` rejects `@`-prefixed and `;`-prefixed subjects (closes symbol-table poisoning vector)
- **H4**: `sanitizeFactField()` strips `\r\n\t` from subjects/objects (closes line-injection vector)
- **H5**: all JSON writes go through `atomicWriteJson()` (tmp + rename, NTFS-atomic)
- **M1**: `safeParseJson()` backs up corrupted files with timestamp before fallback (`.corrupt.<epoch>`)
- **M2**: unknown relations log the fallback to `:=` instead of silently mis-storing semantics
- **M4**: AI-written confidence capped at 0.7 (MED tier). HIGH reserved for Crob research promotion
- **M7**: `addTangent` skips topics in `data.completed`; per-persona log marks them `already_researched`
- **L1**: `coerceNumber()` preserves explicit `0.0` priority/confidence (no more falsy-zero bug)
- **L2**: dead `stripToolRequests` ternary + parameter removed from `processResponse`
- **L5**: `loadFacts()` called once per `formatKnowledgeBlock` invocation, not once per topic

## Previous Session (Session 23) Summary

**Funnel audit validated the collab-audit format fixes in the wild.** Rob ran a real audit on the Kingsbury Creative funnel using the new annotated format. Output passed all 4 evaluator criteria where applicable. Severity rationales produced real reasoning, tool-level verification was genuine, disagreements section surfaced retractions with evidence. Criterion 4 (--context-note) still N/A — flag not used. No code changes, validation only.

## Active Issues

**New this session (deferred audit findings — Crob integration):**
- **#12** (M3): Extract TANGENT/CROB_LEARN tags before journal stripping (pipeline reorder)
- **#13** (M5): Lowercase topic extraction via known-subject lookup
- **#14** (M6): Exclude tag extraction inside code blocks

**From session 22 (collab-audit polish batch):**
- **#7** (medium): `auditContextNote` is module-level side effect, not in parseArgs return
- **#8** (low): Strip Crob references from ANNOTATED_FINDING_FORMAT prompt text
- **#9** (low): Add 'provisional' example to ANNOTATED_FINDING_FORMAT few-shot set
- **#10** (low): Final exchange round should track 'Raised by' for synthesis provenance
- **#11** (low): Fallback report header omits business context from --context-note

**Pre-existing:**
- **#1**: /commands for chatroom control (partially implemented)
- **#6**: Knowledge graph — injection + auto-extraction done, incremental improvements pending

## Remaining Audit Findings (Unfixed)

### Project (claude-collab)
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle
- **M5/N2**: Room management endpoints have no authorization
- L2, L4, L8, L10-L14 (see session 16 handoff in git history)

### Crob integration (deferred to issues #12-#14, plus cosmetic LOWs not tracked)
- L3, L4, L6, L7, L8, L9 — cosmetic, low ROI. See `scratch/crob-integration-audit.md` if needed.

## Pending Work
- **Test the team with the Elon Musk prompt** — Rob queued this as the first exercise to validate the Crob integration in real use ("Imagine you are Elon Musk... starting again as me... what is the next product to bring to market that is web related"). Watch `scratch/watcher.log` for `Crob:` lines — topic injection per persona, `[TANGENT]` queueing, `[CROB_LEARN]` persisting, `[HIGH]/[MED]/[LOW]` prefixes appearing in chatroom. First real test of confidence discipline + per-persona thread continuity.
- **Crob integration polish** — issues #12 (pipeline reorder), #13 (lowercase extraction), #14 (code-block exclusion). All scoped, cheap.
- **Kingsbury Creative funnel audit fixes** — report at `c:/xampp/htdocs/kingsburycreative/audit-report.md`. 2 HIGH (H1 contact form, H2 planner broken), multiple MEDIUM, 1+ LOW. Start with H1+H2.
- **Test --context-note flag** — Fix E still untested in practice
- **Collab-audit polish batch** — issues #7-#11 (~35 min total)
- **Crob Phase 1 baseline** — 5-URL before/after procedure in `c:\xampp\htdocs\crob\tests\README.md`
- **Crob Phase 2** — gated on baseline data
- **Crob client KB pilot** — Stompers wrapper per `crob/docs/CLIENT-KNOWLEDGE-BASE-SPEC.md`
- Test knowledge graph extraction live
- Add graph extraction on manual "End Session" button
- Test curiosity system live
- Test Morgan's scroll-analyzer with a real URL
- Combine 3 poll endpoints into single `?action=poll`
- Mobile sidebar (hamburger toggle)
- Consolidate schema duplication (initDb + migrateDb)
- Watcher owner name: parameterize 'Rob' references in router.js, persona.js, curiosity.js
- message-box/ folder for Soren/Atlas/Morgan feedback
- Stability testing harness (spec S6)

## Key Context
- **Crob is now in the team's workflow.** Each `claude -p` invocation gets `=== CROB KNOWLEDGE ===` (shared facts on extracted topics) + `=== YOUR CROB THREADS ===` (this persona's tangents + contributions). Confidence discipline visible in chatroom; tangents queue Crob research between sessions; learns persist to shared brain. Hybrid: subjective stuff stays personal (journal, curiosity queue, PBLS patterns), objective facts are shared.
- **Crob integration files**: new `watcher/crob.js` (~330 lines), modified `watcher/persona.js` (3 hooks), modified `watcher/claude.js` (2 extractors in pipeline). Watcher restarted PID 30584 — heartbeat fresh as of handoff.
- **Audit-driven hardening**: input sanitization layer between AI output and persistence (the audit's "trust boundary" architectural observation). HIGH-tier confidence reserved for Crob research promotion — AIs cap at 0.7 even if they claim 0.99. Atomic writes via tmp+rename. Parse failures back up the corrupt file before falling back.
- **Watcher changes still NOT in this git repo** (different directory: `c:\claude-collab\`)
- **Audit report**: `c:/claude-collab/scratch/crob-integration-audit.md` (30KB, 21min runtime, 10 invocations, 5 HIGH/7 MED/9 LOW with confidence annotations and a clean self-corrected disagreement on race-condition severity — Atlas was right)
- **Next session**: any model fine. The Elon Musk prompt is a substantive task — Opus would give richer team output. Audit polish batch (#7-11, #12-14) is fine on Sonnet.
