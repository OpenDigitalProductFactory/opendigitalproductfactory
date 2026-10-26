---
status: active
---

# Keep generated preview declarations outside admitted source

BI-6B109903 · WC-09FF5D8D · `codex/preview-generated-declarations`.

## Confirmed defect and existing owners

The October 22 governed preview at source
`4e7aef2560aeee76431090d0d30c3ac20444f11c` completed its clone, then stopped
with `preview_source_changed`. The sole tracked change was Next development
startup rewriting `apps/web/next-env.d.ts` from `.next/types` to
`.next/dev/types`. HEAD and branch remained fixed. No served acceptance passed.
The installed Next declaration writer uses `fs.promises.writeFile`, which a
regular writable file bind supports; simulated filesystem tests do not establish
native Docker bind behavior.

Reuse `scripts/lib/dev-preview-runtime.mjs`, its lease supervisor, existing
Docker Desktop path matcher and Contributor preview lifecycle. Grounding:
`2026-10-11-external-client-verification.md` (bounded clone and exact source),
the delivery-surfaces runbook, current Compose workspace/output volumes and the
installed Next declaration writer. BI-10AC904B covers prior binding safety,
BI-E95458DE startup liveness and BI-B47BB1D7 clone performance; this repair
changes none of their data, timing or authority policies.

## Contract

**OBJ-DECL:** Preview startup permits necessary generated declarations while
preserving the exact clean admitted source and existing runtime fences.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-ISOLATE | OBJ-DECL | The controller owns a fresh private directory and regular declaration file seeded with exact admitted source bytes; only dev-portal binds that file at `/workspace/apps/web/next-env.d.ts`. |
| AC-BIND | OBJ-DECL | Rendered configuration requires a writable long-form bind with `create_host_path: false`; actual inspection verifies the exact source, target, type and RW flag, with no missing, duplicate, foreign or ancestor shadow binding. |
| AC-FENCE | OBJ-DECL | HEAD, branch and complete Git status checks remain unchanged before startup, immediately after init and throughout serving; actual source changes still refuse. |
| AC-CLEAN | OBJ-DECL | Stop and remove only verified owned preview writers, prove no writer references remain, then unlink only owned regular files and their private directory; uncertainty or foreign references retain backing storage and fail closed. |
| AC-PROVE | OBJ-DECL | Meaningful regressions cover the real installed Next writer, overlay tampering, source drift and cleanup failures; governed serving proves actual mount identity, clean source, health and preview-bound sign-in before claiming runtime success. |

No source-status exemption, app-directory overlay, node_modules backing trick,
generated churn commit, hand-built image, schema/data change, production advance,
grant change or timing-limit change belongs to this slice. Init runs unchanged;
its post-completion source check remains mandatory. Overlay directories use a
fresh nonce under canonical state storage and carry the admitted lease/SHA and
worktree identity. Existing node_modules/output volumes remain intact.

## Ordered atomic implementation plan

1. **FLOW-RED / VC-RED:** reproduce the tracked declaration rewrite in a temporary
   Git fixture using the installed Next writer; make the portal projection
   isolation assertion fail before production changes.
2. **FLOW-OVERLAY / CONTRACT-DECL:** add one helper for private file creation,
   config/actual mount validation and narrow storage cleanup; integrate it into
   the existing preview owner. Keep the full source predicate and all existing
   data/lease/auth/protected-service checks intact.
3. **FLOW-CLEAN / CONTRACT-WRITERS:** discover exact owned writers and all
   references to this attempt's file. Preserve foreign containers; stop/remove
   inspected owned IDs only. Retain backing on unreadable/uncertain cleanup.
4. **VC-SOURCE:** run declaration, preview owner, workspace and supervisor tests,
   affected source guards, both package TypeScript programs as required and the
   exact committed canonical gate. Current resolved impact advice names no
   tests/guards; include adjacent tests and exhaustive canonical verification.
   Regenerate the doc index; Mermaid output is unchanged and checked only.
5. **VC-SERVED:** after source qualification, admit one unchanged-policy governed
   preview with the actual owning session. Keep the foreground keeper alive,
   prove actual mount and clean source plus health, issue preview-bound sign-in
   and inspect a harmless task. Never click Upgrade or Restore. Clean up and
   release. A blocked preview is unrun acceptance, not a product pass.
6. **VC-REVIEW:** obtain independent exact-source review, publish a ready DCO PR,
   follow protected checks/queue and record actual delivery/acceptance separately.

## Backlog coverage

Atomic deliverable `DECL-ISOLATION` maps to BI-6B109903. Requirement refs:
AC-ISOLATE, AC-BIND, AC-FENCE, AC-CLEAN, AC-PROVE. Contract refs:
CONTRACT-DECL, CONTRACT-WRITERS. Flow refs: FLOW-RED, FLOW-OVERLAY, FLOW-CLEAN.
Verification refs: VC-RED, VC-SOURCE, VC-SERVED, VC-REVIEW. No dependencies.
Creation, validation and safe reclamation form one generated-file lifetime;
shipping any one alone either preserves the defect or introduces an unsafe
mount/cleanup path. The native coverage receipt is recorded against this
immutable document and retained in the Workroom rather than rewriting its bytes.

## Risks and rollback

Missing file binds can become directories under Docker's default behavior;
explicit no-create and regular-file checks prevent that. Host paths differ on
Windows/Desktop; reuse exact canonical matching and fresh daemon qualification.
Cleanup cannot infer authority from a path or label alone. Lost inspection or
foreign references preserve files rather than removing another writer's input.
Revert this source change as one normal PR; no persistent-data rollback exists.

Bootstrap misattribution was recorded as BI evidence
`cmvjwsjh73e3201pnj3mlr4vi`. Its approved handoff executed; this repair uses the
detected Codex session `01a164cc-a42c-7011-9fdb-7f82bc6679ea`. Bootstrap identity
selection itself is a separate issue and is not changed here. Funding ownership
is unresolved; no budget allocation is inferred from execution authority.
