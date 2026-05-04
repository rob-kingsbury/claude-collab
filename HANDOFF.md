# Handoff -- 2026-05-04 (Session 25)

## What Happened This Session

### Summary
**Fixed `--only` / `--soren-only` flag not scoping collab-audit.** Two bugs: (1) SKILL.md had no explicit participant-scoping step, so Claude would follow the instructions and omit `--only` entirely. Fixed by adding Step 2.5 with a routing table. (2) Plan mode in audit.js ignored `--only` completely — loaded all three personas unconditionally and only short-circuited for the legacy `sorenOnly` check. Fixed to mirror audit mode: conditional persona loading, `planSingle` for any single-participant early return, filtered `planParticipants` for exchange rounds. Verified with live `--only "atlas"` test — startup banner showed "Auditors: Atlas (architecture), Phases: 1".

## Previous Session (Session 24) Summary

**Crob integration shipped to chatroom — hybrid memory live.** Built `watcher/crob.js` as the bridge between the watcher and Crob's data files. Wired three layers: shared knowledge injection, per-persona tangent threads, confidence discipline. New tags: `[TANGENT]`, `[CROB_LEARN]`, `[HIGH]/[MED]/[LOW]`. Then ran collab-audit on the changes — 5 HIGH, 7 MED, 9 LOW. Fixed all HIGH + 5/7 MED + 3/9 LOW. Deferred M3/M5/M6 as issues #12-14. Bumped `STANDARD_TIMEOUT_MS` to 300s to fix Soren's retry loop on deep research tasks.

## Active Issues

**Crob integration polish (deferred audit findings):**
- **#12** (M3): Extract TANGENT/CROB_LEARN tags before journal stripping (pipeline reorder)
- **#13** (M5): Lowercase topic extraction via known-subject lookup
- **#14** (M6): Exclude tag extraction inside code blocks

**Collab-audit polish batch:**
- **#7** (medium): `auditContextNote` is module-level side effect, not in parseArgs return
- **#8** (low): Strip Crob references from ANNOTATED_FINDING_FORMAT prompt text
- **#9** (low): Add 'provisional' example to ANNOTATED_FINDING_FORMAT few-shot set
- **#10** (low): Final exchange round should track 'Raised by' for synthesis provenance
- **#11** (low): Fallback report header omits business context from --context-note

**Pre-existing:**
- **#1**: /commands for chatroom control (partially implemented)
- **#6**: Knowledge graph — injection + auto-extraction done, incremental improvements pending
- **#15**: Attachments aren't visible to the team in chat

## Remaining Audit Findings (Unfixed)

### Project (claude-collab)
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle
- **M5/N2**: Room management endpoints have no authorization
- L2, L4, L8, L10-L14 (see session 16 handoff in git history)

### Crob integration (deferred to issues #12-#14, plus cosmetic LOWs not tracked)
- L3, L4, L6, L7, L8, L9 — cosmetic, low ROI. See `scratch/crob-integration-audit.md` if needed.

## Pending Work
- **Test the team with the Elon Musk prompt** — still queued. Watch `scratch/watcher.log` for `Crob:` lines — topic injection per persona, `[TANGENT]` queueing, `[CROB_LEARN]` persisting, `[HIGH]/[MED]/[LOW]` prefixes appearing in chatroom.
- **Crob integration polish** — issues #12 (pipeline reorder), #13 (lowercase extraction), #14 (code-block exclusion). All scoped, cheap.
- **Kingsbury Creative funnel audit fixes** — report at `c:/xampp/htdocs/kingsburycreative/audit-report.md`. 2 HIGH (H1 contact form, H2 planner broken), multiple MEDIUM, 1+ LOW. Start with H1+H2.
- **Test --context-note flag** — still untested in practice
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
- **`--only` / `--soren-only` now work correctly** in both audit mode and plan mode. Verified live.
- **Crob is in the team's workflow.** Each `claude -p` invocation gets `=== CROB KNOWLEDGE ===` + `=== YOUR CROB THREADS ===`. Confidence discipline visible in chatroom; tangents queue Crob research; learns persist to shared brain.
- **Crob integration files**: `watcher/crob.js` (~380 lines), modified `watcher/persona.js` (3 hooks), modified `watcher/claude.js` (2 extractors in pipeline).
- **Watcher changes NOT in this git repo** (different directory: `c:\claude-collab\`)
- **Next session**: Test the Elon Musk prompt with the team to validate Crob integration end-to-end. Then Kingsbury Creative H1+H2 fixes. Collab-audit polish batch (#7-11, #12-14) any time.
