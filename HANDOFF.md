# Handoff -- 2026-04-14 (Session 22)

## What Happened This Session

### Summary
**Crob Phase 1 shipped + collab-audit hardened.** Implemented confidence vectors in Crob (source-aware three-tier merge, provenance sidecar, --verbose output, 6 test scripts, all green). Rewrote Crob README. Committed to crob repo in 3 commits. Then added annotated finding format + few-shot examples to collab-audit synthesis prompts. Then shipped adversarial posture + tool-level verification requirement + severity rationale + --context-note CLI flag to close off reflexive-agreement and severity-drift failure modes. Self-audited the audit.js changes with Soren+Atlas — passed (1 medium + 7 low findings, all queued as GitHub issues).

### Changes

**claude-collab (this repo):**

| File | Change |
|------|--------|
| `collab-audit/audit.js` | 4 commits: (1) annotated finding format + confidence tiers, (2) few-shot examples, (3) adversarial posture + severity rationale + `--context-note` flag, (4) unified `contextSection()` helper replacing 13 inline `focusSection` constructions |

**Crob (separate repo, not tracked here):**

| File | Change |
|------|--------|
| `src/Brain.php` | Two-decimal confidence, `$source` param on `learn()`, three-tier merge logic, provenance sidecar IO, `extractDomain()`, `relationName()`, `getProvenance()` |
| `src/Research.php` | Per-URL learn loop, removed `array_unique()` on facts, `--verbose` output |
| `src/Crob.php` | `$verbose` constructor param, `'direct_teach'` source sentinel |
| `crob.php` | `--verbose`/`-v` flag parsing |
| `tests/` | 6 manual test scripts + README with baseline procedure |
| `README.md` | Full rewrite documenting current 5-component architecture |
| `docs/CLIENT-KNOWLEDGE-BASE-SPEC.md` | NEW — per-client Crob wrapper design doc |

## Previous Session (Session 21) Summary

Crob confidence vectors design locked via two Soren+Atlas+Morgan collab plan reviews. Two open questions resolved unanimously (three-tier bumps, `distinct_objects: int` schema). Ready for Opus plan mode next session — which happened and shipped in this session.

## Active Issues

**New this session (from self-audit of audit.js changes):**
- **#7** (medium): `auditContextNote` is module-level side effect, not in parseArgs return
- **#8** (low): Strip Crob references from ANNOTATED_FINDING_FORMAT prompt text
- **#9** (low): Add 'provisional' example to ANNOTATED_FINDING_FORMAT few-shot set
- **#10** (low): Final exchange round should track 'Raised by' for synthesis provenance
- **#11** (low): Fallback report header omits business context from --context-note

**Pre-existing:**
- **#1**: /commands for chatroom control (partially implemented)
- **#6**: Knowledge graph — injection + auto-extraction done, incremental improvements pending

## Remaining Audit Findings (Unfixed)

### High
- **H1**: No authentication — security depends on Apache binding to 127.0.0.1
- **H2**: Mobile sidebar inaccessible — `display: none` below 640px with no toggle

### Medium
- **M5/N2**: Room management endpoints have no authorization

### Low
- L2, L4, L8, L10-L14 (see session 16 handoff in git history)

## Pending Work
- **Collab-audit polish batch** — issues #7, #8, #9, #10, #11 (~35 min total). Start with #7 (architectural), the rest slot in after
- **Funnel audit results review** — Rob is running a funnel audit on `kingsburycreative` with the new format; validate output against the 4-criterion check prompt
- **Crob Phase 1 baseline** — run the before/after 5-URL procedure in `c:\xampp\htdocs\crob\tests\README.md` to validate confidence weights produce real differentiation
- **Crob Phase 2** — gated on baseline data. Voice.php confidence-aware output (Direction C)
- **Crob client KB pilot** — build the wrapper for Stompers per `crob/docs/CLIENT-KNOWLEDGE-BASE-SPEC.md`
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
- **Crob Phase 1 is LIVE** — shipped in 3 commits to crob repo. Tests green. Baseline not yet run (needs network-dependent URL learns).
- **collab-audit annotated format is LIVE** — every future audit/plan review gets confidence tiers, severity rationales, adversarial posture, and optional `--context-note` business context. Global skill is a junction to this repo's `collab-audit/` so changes are immediate.
- **Validation check prompt** for audit output — see earlier in this session's chat history. Ask Claude to evaluate audit-report.md against 4 criteria (severity rationale, tool-level verification, disagreements populated, context-cited severity). If any fail, bring results back to iterate on prompt directives.
- **Self-audit of audit.js passed** — 0 critical, 0 high, 1 medium, 7 low. Report at `collab-audit/audit-report.md` (gitignored). All 5 actionable findings queued as issues #7-#11.
- **Watcher changes still NOT in this git repo** (different directory)
- **Next session**: ideally on Opus for architectural work (#7 fix), Sonnet fine for the polish batch (#8-11)
