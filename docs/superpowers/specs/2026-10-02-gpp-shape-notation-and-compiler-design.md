---
status: draft
---

# GPP shape notation, execution semantics and compiler

| | |
|---|---|
| Date | 2026-10-02 |
| Epic | EP-B932453F |
| Backlog | BI-6DA17863 |
| Parent design | [GPP model to execution](2026-10-01-gpp-model-to-execution-design.md), Part I (§4), §7, §8 Phases 3–5 |
| Normative owner | [GPP](../../architecture/gated-permissions-process.md) §7, §10, §12. This spec proposes how DPF realizes GPP §12.4.1 for work shapes. |
| Decision relied on | DI-035897A0F1D6 (WWMD): the source of truth is a JSON-Schema superset of `WorkShapeDefinition`; iconography derives from BPMN and lives on the existing `@xyflow/react` EA canvas; BPMN-subset and SysML v2 textual notation are export formats only |
| Verified against | `origin/main` at `e2d22ad43` |

This is the child of the parent design. The parent fixes the direction: a shape document, a
compiler, three trust properties and a phased plan. This spec turns Part I into something a
contributor can implement and test. It carries its own scope baseline (§12). It does not change
the parent, which is the approved baseline for BI-69415B68.

## 1. Problem

GPP §12.4.1 says a `GPP-Modeled` implementation must hold its model in a machine-readable form and
either execute it or verify the runtime against it. DPF meets half of that today:

- **The runtime does read a declared model.** Work shapes are TypeScript constants of type
  `WorkShapeDefinition` (`apps/web/lib/work-management/work-shapes.ts`). The workroom drive
  (`resolveDrivePlan` in `apps/web/lib/work-management/drive-resolution.ts`, run by
  `apps/web/lib/queue/functions/workroom-drive.ts`) dispatches stages from that declaration.
- **The model cannot be designed as a model.** There is no document a modeller can open, draw,
  check and compile. The only way to change a shape is to edit TypeScript.
- **Every model-shaped artifact runs code → model.** The EA/SysML parity engine
  (`apps/web/lib/ea/reconcile-sysml-projections.ts`), the process extractor
  (`apps/web/lib/ea/process-extract.ts`) and the room shape view
  (`apps/web/lib/work-management/shape-projection.ts`, rendered by
  `apps/web/components/workspace/workroom/WorkroomShape.tsx`) all derive pictures from code. No path
  goes from a model to the runtime.
- **The gate fields are untyped.** A governed advance is
  `{ kind: "governed-decision", condition, decisionScope }`. `decisionScope` is a free string. It
  does not say which authority owns the gate (WWMD, WWWD or WSID), whether the gate is enforced or
  shadow, or whether it blocks.

What this spec adds is the CAM step of the parent's CAD → CAM → machine chain: a shape document, a
compiler that emits the `WorkShapeDefinition` the runtime already reads, a decompiler that proves the
document format loses nothing, and design-rule checks that run before anything is emitted.

## 2. Current state, measured

Counted by importing the registry on `e2d22ad43` (`listWorkShapes()` and
`WORK_SHAPE_PRIOR_VERSIONS`), not by reading prose.

| Fact | Value | Source |
|---|---|---|
| Current declared shapes | **47** | `work-shapes.ts` `ALL_SHAPES` |
| Split by file | anchor 1 (`work-shapes.ts`), standing operations 12, coworker standing 11, coworker operate 4, coworker craft 4, delivery 5, orchestration 10 | `standing-operations-shapes.ts`, `coworker-standing-shapes.ts`, `coworker-standing-shapes-operate.ts`, `coworker-standing-shapes-craft.ts`, `delivery-shapes.ts`, `orchestration-shapes.ts` |
| Frozen prior versions that live rooms may pin | **4** (`pull-request-flow-watch`, `payables-watch`, `vendor-renewal-watch`, `contributor-intake-watch`, each `1.0.0`) | `work-shape-prior-versions.ts` |
| Definitions the compiler must reproduce | **51** (47 + 4) | |
| Stages | 153 | |
| Governed-decision advances | 55, using 50 distinct `decisionScope` strings | |
| Accountable principal of those 55 | all `role:` | |
| Stages that declare `tools` | 58 (106 tool names, 45 distinct tools) | |
| Agent stages of cadence shapes with no tools, on the shrink-only list | 13 | `KNOWN_STAGE_TOOL_GAPS` in `stage-tool-gaps.ts` |
| Stop conditions | 141, each with a `disposition` | |
| Evidence kinds a stage may declare | 48 | `WORK_SHAPE_EVIDENCE_KINDS` in `work-shape-evidence-kinds.ts` |

How the runtime moves through a shape today:

- One token, sequential by array index. `nextStageKey` in `drive-resolution.ts` returns the current
  stage until it has a completing receipt, then `stages[index + 1]`, then `null`.
- A stage completes when the drive earns a completing receipt from recorded evidence of a kind the
  stage declared (`earnEvidenceReceipts` in `stage-evidence-receipts.ts`).
- A governed-decision stage with a `role:` or `person:` principal becomes an attention plan. The
  drive refuses to execute it. A person records the decision as `decision-record` evidence through
  `workroom-stage-decision.ts`. The drive still owns the advance.
- There is no parallel split, no join, no rework edge, no stage timer and no sub-shape.

Version handling already exists and this spec reuses it:

- GPP §2.1.1 classification of a version change: `diffWorkShapeBinding` in
  `work-shape-binding-diff.ts` (narrowing / widening / unchanged).
- Governed rebind of a pinned room: `planWorkroomShapeRebind` in `workroom-shape-rebind.ts`
  (spec: `2026-10-01-workroom-shape-rebind-design.md`).

GPP Phase 2 code that the compiler must feed, not replace (`apps/web/lib/gpp/`):

- `GPP_BINDINGS` in `bindings.ts`: two hand-declared bindings (`tak-alignment-admit`,
  `human-checkpoint-admit`), keyed by a tool predicate, not attached to a shape stage. The file says
  it stays hand-declared "until the Phase 3 compiler emits binding records".
- `PermitClaims` in `permit-claims.ts`: `shapeRef` and `stageKey` exist and are nullable.
- `GPP_BINDING_ENFORCEMENT` in `binding-enforcement.ts`: the enforced set, empty at merge, changed
  only by reviewed PR.
- `resolveMonitorPermit` (`permit-verdict.ts`) and `decidePermitEnforcement`
  (`permit-enforcement.ts`), called from `governedExecuteTool` in `apps/web/lib/mcp-governed-execute.ts`.

The EA side:

- The canvas is `apps/web/components/ea/EaCanvas.tsx` on `@xyflow/react` 12 with `elkjs`. BPMN
  nodes already have custom renderers (`BpmnTaskNode.tsx`, `BpmnGatewayNode.tsx`,
  `BpmnEventNode.tsx`, `BpmnLaneNode.tsx`), dispatched in `EaElementNode.tsx` on the `BPMN__` label.
- BPMN 2.0 element types are seeded by `packages/db/src/seed-ea-bpmn20.ts`.
- Positions persist in `EaView.canvasState`. `EaView` already has `status`, `submittedAt`,
  `approvedAt`, and `EaSnapshot` exists; no view approval workflow is wired to them yet.
- Stable projection identity already has a convention: `applySysmlModel` in
  `packages/db/src/sysml-model-seed.ts` writes a stable source key to `EaElement.infraCiKey`.

## 3. Overlap with existing work (AGENTS.md §1)

| Existing work | Relationship | What this spec does with it |
|---|---|---|
| Parent spec Part I | Refines | Keeps the 15 constructs, the three trust properties and the acceptance test. Corrects four details (§3.1). |
| `WorkShapeDefinition` and the drive | Compile target | The compiler emits exactly this type. New fields are optional and additive. |
| `stage-tool-parity.test.ts` (C-1, C-2, C-4 first condition) | Reused | The DRC calls the same resolvers. It does not re-derive tool or grant rules. |
| `work-shape-binding-diff.ts` | Reused | Change classification of a new document version is this function over the emitted definitions. |
| `apps/web/scripts/build-route-manifest.ts` (`--check`) and `.github/workflows/audit-route-manifest.yml` | Pattern reused | Generated, committed, byte-stable output with a `--check` mode in CI. |
| `applySysmlModel` and `EaConformanceIssue` | Reused | Design-view projection and divergence surfacing (§9). |
| GPP Phase 2 (`apps/web/lib/gpp/*`) | Fed | The compiler emits binding records in the `GppBinding` shape. It never writes `GPP_BINDING_ENFORCEMENT`. |
| EP-MBSE-WORKROOM-SPINE: BI-B8B3FB70, BI-A83D5FB8, BI-580A970A, BI-FA970AE2 | Fed, not duplicated | See §3.2. |

### 3.1 Corrections to the parent

1. **The count is 47 current shapes, but the compiler must reproduce 51 definitions.** The four
   frozen prior versions in `work-shape-prior-versions.ts` are live: rooms resolve against them.
2. **The Build Studio flow cannot be decompiled.** It is not a `WorkShapeDefinition`. It lives in
   `PHASE_ORDER` / `ALLOWED_TRANSITIONS` (`lib/explore/feature-build-types.ts`),
   `checkPhaseGate` (`lib/explore/build-process-matrix.ts`), `PLAN_TO_BUILD_GATE_PROFILES`
   (`lib/build/plan-to-build-transition-core.ts`) and the gate modules. It is hand-authored as a
   document in Phase 5 (§11), not decompiled in Phase 3.
3. **A gate sits on the stage's exit, not on arrival at the next stage.** In every current shape the
   governed decision is the advance *out of* the stage whose `role:` principal decides (for example
   `inquiry-response-watch` stage `send`). The catalog maps the gate to that stage's outgoing edge.
4. **Stage permits need a binding attachment that does not exist yet.** Phase 2 mints a permit per
   call when `tak-alignment` or `coworker-authority-escalation` admits it. `GppBinding` has no
   `shapeRef` / `stageKey`. Minting at a stage gate needs that attachment (§6.4).

Smaller notes: C-5 is not computed on main (`bindings.ts` says so), so the DRC reports it as
not evaluated rather than passing it. The parent's 33 direct `executeTool(` sites are now 26 sites
in 13 files (GPP revision 0.7). The EA view approval substrate exists in the schema; the missing
piece is the workflow, not the tables.

### 3.2 EP-MBSE-WORKROOM-SPINE

That epic decides **who** is in a room, from the IT4IT participation matrix. This spec decides
**what** the room does: its stages, gates, capability sets and stops. They meet at the stage.

| Item | What it builds | How this spec feeds it |
|---|---|---|
| BI-B8B3FB70 (Edge 1) | A room can sit at an IT4IT value-stream stage | No overlap. A shape document never resolves value-stream structure. A document stage id is stable, so a later document can name its IT4IT stage reference without a format change. |
| BI-A83D5FB8 (Edge 2) | Participants derived from `Agent.it4itSections` | No overlap. The document names one accountable principal per stage. The derived roster is a separate input. Once Edge 2 lands, DRC C-4 can check the accountable principal against the derived participants as well as against grants. |
| BI-580A970A (Edge 4) | The R2D reference room, linear spine forking at Deploy per target | The fork per target is a parallel split/join. That is construct 12 here, which the runtime does not execute yet (§5.4). R2D is the natural first non-sequential document once it does. This spec does not stand up the room. |
| BI-FA970AE2 (Edge 3) | Drift both ways, extending `reconcile-it4it-coverage.ts` | Shares the surface, not the engine. This spec's V-4 divergences (C-6, C-8) go onto the same `EaConformanceIssue` records and EA conformance cards. Neither builds a second conformance engine. |

Conclusion: no duplication. The epic and this spec are two inputs to the same stage element.

## 4. The shape document

### 4.1 Files and formats

| Artifact | Path (proposed) | Edited by | Compiled? |
|---|---|---|---|
| Shape document | `apps/web/lib/work-management/shape-documents/<key>.gpp.json` | Modeller (canvas or text), via PR | Yes |
| Layout sidecar | `apps/web/lib/work-management/shape-documents/<key>.layout.json` | Canvas | Never |
| Published schema | `apps/web/lib/gpp/shape-language/gpp-shape.schema.json` | Generated | n/a |
| Schema implementation | `apps/web/lib/gpp/shape-language/gpp-shape-schema.ts` (Zod) | Contributor | n/a |
| Emitted shape | `apps/web/lib/work-management/generated/<key>.shape.generated.ts` | Compiler only | Output |
| Emitted bindings | `apps/web/lib/gpp/generated/shape-bindings.generated.ts` | Compiler only | Output |
| Ratification report | `apps/web/lib/gpp/generated/gate-ratification-report.json` | Compiler only | Output |

The document holds one shape version. A version bump moves the old document to
`shape-documents/prior/<key>@<version>.gpp.json`, which mirrors how `work-shape-prior-versions.ts`
freezes a superseded definition today.

**Schema source.** The schema is written once in Zod, which `apps/web` already depends on
(`zod` ^4.6 in the workspace catalog). The published JSON Schema is generated with Zod 4's
`z.toJSONSchema`, whose default target is draft 2020-12, and committed. A test fails if the
committed file differs from the generated one. No JSON Schema validator package is added
(AGENTS.md §7, absorb don't adopt). External tools validate against the committed file.

### 4.2 Schema

The schema below is the contract. It is closed (`additionalProperties: false` at every level):
an unknown field is a validation error, which is what keeps decompile/recompile honest. Fields
marked *(new)* have no home in today's `WorkShapeDefinition` and are added to it as optional
fields (§4.4).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:dpf:gpp-shape:0.1",
  "title": "GPP shape document",
  "type": "object",
  "additionalProperties": false,
  "required": ["format", "key", "version", "title", "description", "triggers", "stages",
               "stopConditions", "grants", "measures", "budgets", "reviewPoint", "collaborationShape"],
  "properties": {
    "format": { "const": "gpp-shape/0.1" },
    "key": { "$ref": "#/$defs/slug" },
    "version": { "$ref": "#/$defs/semver" },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1 },
    "triggers": {
      "type": "array", "minItems": 1, "uniqueItems": true,
      "items": { "enum": ["claim", "cadence", "deadline-horizon", "authority-change",
                          "estate-drift", "evidence-decay", "escalation"] }
    },
    "stages": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/stage" } },
    "flow": { "$ref": "#/$defs/flow" },
    "stopConditions": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/stop" } },
    "grants": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "measures": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false, "required": ["key", "description"],
        "properties": { "key": { "$ref": "#/$defs/slug" }, "description": { "type": "string" } }
      }
    },
    "budgets": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false, "required": ["kind", "limit", "unit"],
        "properties": {
          "kind": { "enum": ["findings-per-run", "cycles-per-window", "spend"] },
          "limit": { "type": "number" },
          "unit": { "type": "string" }
        }
      }
    },
    "reviewPoint": {
      "type": "object", "additionalProperties": false, "required": ["everyDays", "description"],
      "properties": {
        "everyDays": { "type": "number", "exclusiveMinimum": 0 },
        "description": { "type": "string" }
      }
    },
    "collaborationShape": {
      "enum": ["specialist-alignment", "approval-sign-off", "outward-review",
               "change-consequential", "escalation", "craft-stewardship", null]
    }
  },
  "$defs": {
    "slug": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "semver": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "principalRef": { "type": "string", "pattern": "^(agent|role|person):.+$" },
    "toolName": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "authority": { "enum": ["wwmd", "wwwd", "wsid"] },
    "evidenceKind": {
      "$comment": "Generated from WORK_SHAPE_EVIDENCE_KINDS (work-shape-evidence-kinds.ts).",
      "enum": ["acceptance-receipt", "architecture-review-receipt", "assurance-finding",
        "assurance-run", "backlog-items", "child-completion", "cited-brief", "cited-finding-list",
        "conversation-turn", "decision-record", "decomposition-receipt", "deployment-record",
        "design-doc", "draft-artifact", "drift-report", "epic-hypothesis", "exception-list",
        "failing-test", "import-run", "item-body-design", "manual-check", "merged-sha",
        "objective-baseline", "org-business-answer", "outcome-packet", "outcome-reconciliation",
        "passing-test", "pir-receipt", "plan-coverage-receipt", "plan-doc", "plan-review-receipt",
        "policy-divergence-list", "policy-draft", "pr-gate", "reconciliation", "reproduction",
        "research-question", "research-receipt", "runtime-check", "screen-capture-set",
        "security-case-timeline", "security-case-verdict", "source-document-set",
        "source-verified", "spec-approval-receipt", "surface-inventory", "tool-evaluation",
        "ux-verified"]
    },

    "stage": {
      "type": "object", "additionalProperties": false,
      "required": ["key", "title", "accountablePrincipalRef", "advance", "evidence"],
      "properties": {
        "key": { "$ref": "#/$defs/slug" },
        "title": { "type": "string", "minLength": 1 },
        "accountablePrincipalRef": { "$ref": "#/$defs/principalRef" },
        "advance": { "$ref": "#/$defs/advance" },
        "evidence": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/evidenceKind" } },
        "tools": {
          "$comment": "Capability set. Absent means undeclared, exactly as today.",
          "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/toolName" }
        },
        "binding": { "$ref": "#/$defs/binding" },
        "deadline": { "$ref": "#/$defs/timer" },
        "subShape": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$" }
      }
    },

    "advance": {
      "oneOf": [
        {
          "type": "object", "additionalProperties": false, "required": ["kind", "condition"],
          "properties": {
            "kind": { "const": "status-change" },
            "condition": { "type": "string", "minLength": 1 }
          }
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "condition", "decisionScope"],
          "properties": {
            "kind": { "const": "governed-decision" },
            "condition": { "type": "string", "minLength": 1 },
            "decisionScope": { "type": "string", "minLength": 1 },
            "gate": { "$ref": "#/$defs/gate" }
          }
        }
      ]
    },

    "gate": {
      "$comment": "(new) Typed gate fields. GPP §7 elements 3, 4, 9, 11.",
      "type": "object", "additionalProperties": false,
      "required": ["authority", "mode", "blocking", "resolution"],
      "properties": {
        "authority": { "$ref": "#/$defs/authority" },
        "gateKey": { "type": "string", "minLength": 1 },
        "mode": { "enum": ["shadow", "enforced"] },
        "blocking": { "type": "boolean" },
        "resolution": { "enum": ["doctrine", "accountable-human", "doctrine-then-human"] },
        "resolver": {
          "type": "object", "additionalProperties": false, "required": ["module", "exportName"],
          "properties": { "module": { "type": "string" }, "exportName": { "type": "string" } }
        },
        "advisory": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["authority"],
            "properties": {
              "authority": { "$ref": "#/$defs/authority" },
              "gateKey": { "type": "string" },
              "blocking": { "const": false }
            }
          }
        },
        "checkpoint": { "$ref": "#/$defs/checkpoint" },
        "escalation": { "$ref": "#/$defs/escalation" },
        "onRefuse": {
          "$comment": "Where a refuse verdict sends the token: a stop id or an earlier stage key.",
          "type": "string", "minLength": 1
        }
      }
    },

    "checkpoint": {
      "$comment": "(new) Human checkpoint. exactAction binds approval to the call's paramHash.",
      "type": "object", "additionalProperties": false, "required": ["role", "exactAction"],
      "properties": {
        "role": { "$ref": "#/$defs/principalRef" },
        "exactAction": { "type": "boolean" }
      }
    },

    "escalation": {
      "$comment": "(new) GPP §7 element 9.",
      "type": "object", "additionalProperties": false, "required": ["role", "whileWaiting"],
      "properties": {
        "role": { "$ref": "#/$defs/principalRef" },
        "whileWaiting": { "const": "hold" }
      }
    },

    "binding": {
      "$comment": "(new) The stage's Gated Permission binding. Version is separate from the shape version (GPP §2.1.1).",
      "type": "object", "additionalProperties": false, "required": ["id", "version", "enforcement"],
      "properties": {
        "id": { "$ref": "#/$defs/slug" },
        "version": { "type": "integer", "minimum": 1 },
        "enforcement": { "enum": ["absent", "shadow", "enforced", "environment"] },
        "subjectScope": { "type": "string" },
        "validity": {
          "type": "object", "additionalProperties": false, "required": ["until"],
          "properties": {
            "until": { "const": "stage-exit" },
            "maxDuration": { "type": "string", "pattern": "^P(\\d+D)?(T(\\d+H)?(\\d+M)?)?$" }
          }
        },
        "egress": {
          "$comment": "Declared ports out of an environment boundary. Required when enforcement is environment.",
          "type": "array", "items": { "$ref": "#/$defs/toolName" }
        }
      },
      "if": { "properties": { "enforcement": { "const": "environment" } } },
      "then": { "required": ["egress"] }
    },

    "timer": {
      "$comment": "(new) Stage deadline. Raises a deadline event; never moves the token.",
      "type": "object", "additionalProperties": false, "required": ["afterDays", "description"],
      "properties": {
        "afterDays": { "type": "number", "exclusiveMinimum": 0 },
        "description": { "type": "string" }
      }
    },

    "stop": {
      "type": "object", "additionalProperties": false, "required": ["kind", "condition", "disposition"],
      "properties": {
        "kind": { "enum": ["success", "failure", "budget"] },
        "condition": { "type": "string", "minLength": 1 },
        "disposition": { "enum": ["proceed", "awaiting-person", "awaiting-input", "inconclusive", "refused"] }
      }
    },

    "flow": {
      "$comment": "(new) Explicit graph. Absent means the sequential flow every current shape has.",
      "type": "object", "additionalProperties": false, "required": ["nodes", "edges"],
      "properties": {
        "nodes": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["id", "type"],
            "properties": {
              "id": { "$ref": "#/$defs/slug" },
              "type": { "enum": ["parallel-split", "parallel-join"] },
              "pairs": { "$ref": "#/$defs/slug" }
            }
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["from", "to"],
            "properties": {
              "from": { "type": "string", "minLength": 1 },
              "to": { "type": "string", "minLength": 1 },
              "rework": {
                "type": "object", "additionalProperties": false, "required": ["maxIterations"],
                "properties": { "maxIterations": { "type": "integer", "minimum": 1 } }
              }
            }
          }
        }
      }
    }
  }
}
```

Rules the schema states on purpose:

- **Consequence class is never authored.** A tool chip's R / W / A / O / I badge is computed from
  `classifyConsequentialTool` (`apps/web/lib/tak/consequential-tool-policy.ts`) at compile and
  render time. A document cannot claim a tool is a read.
- **`tools` absent and `tools: []` differ.** Absent keeps today's "undeclared" meaning. An empty
  array is a declaration that the stage reaches nothing.
- **Element identity is derived, not stored.** Ids are computed from keys (§9.1), so a document
  needs no id field that the emitted definition would have to carry.
- **`flow` is optional.** Without it, flow is `stages[0] → stages[1] → … → stop`, which is what
  `nextStageKey` executes. Every decompiled document omits `flow`.

### 4.3 Layout sidecar

The sidecar holds only presentation. The compiler never reads it. Editing it never changes the
emitted definition, so a layout-only PR has an empty compile diff.

```json
{
  "format": "gpp-layout/0.1",
  "shape": "inquiry-response-watch@1.0.0",
  "nodes": {
    "trigger:escalation": { "x": 0, "y": 40 },
    "trigger:cadence": { "x": 0, "y": 120 },
    "stage:draft": { "x": 120, "y": 60, "w": 220, "h": 96 },
    "stage:send": { "x": 420, "y": 60, "w": 220, "h": 96 },
    "gate:send": { "x": 680, "y": 92 },
    "stop:success:1": { "x": 780, "y": 20 },
    "stop:failure:1": { "x": 780, "y": 100 },
    "stop:budget:1": { "x": 780, "y": 180 }
  },
  "edges": {},
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

The canvas reads the sidecar into `EaView.canvasState` and writes it back on save. A sidecar id
that matches no element is a DRC warning (W-ORPHAN-LAYOUT), not an error.

### 4.4 Additions to `WorkShapeDefinition`

All optional, so every existing shape stays valid and every existing reader is unaffected:

| Field | Type | Construct |
|---|---|---|
| `WorkShapeAdvance` governed variant: `gate?` | `WorkShapeGate` (mirrors the schema's `gate`) | 4, 5, 7, 10 |
| `WorkShapeStage.binding?` | `WorkShapeBinding` | 3, 15 |
| `WorkShapeStage.deadline?` | `{ afterDays; description }` | 11 |
| `WorkShapeStage.subShape?` | `` `${string}@${string}` `` | 14 |
| `WorkShapeDefinition.flow?` | `WorkShapeFlow` | 12, 13 |

`readWorkShapeDefinitionContract` passes `flow` through. `diffWorkShapeBinding` gains rows for the
new fields (for example `gate-mode-relaxed` as widening, `binding-enforcement-raised` as narrowing)
in the slice that first emits them.

### 4.5 Worked example: `inquiry-response-watch@1.0.0`

A current standing shape (`standing-operations-shapes.ts`), converted. Every field except the
`gate` block is a field-for-field copy of the registry value.

```json
{
  "format": "gpp-shape/0.1",
  "key": "inquiry-response-watch",
  "version": "1.0.0",
  "title": "Inquiry response watch",
  "description": "The customer advisor drafts a grounded reply to each waiting inquiry and attaches the evidence it rests on. Sending is a human stage by construction — anything leaving the business under its own name is never an unattended act.",
  "triggers": ["escalation", "cadence"],
  "stages": [
    {
      "key": "draft",
      "title": "Draft a grounded reply",
      "accountablePrincipalRef": "agent:customer-advisor",
      "advance": {
        "kind": "status-change",
        "condition": "Every waiting inquiry has a draft reply whose every claim cites recorded evidence."
      },
      "evidence": ["draft-artifact"],
      "tools": ["list_storefront_activity", "list_customer_accounts"]
    },
    {
      "key": "send",
      "title": "Send the reply",
      "accountablePrincipalRef": "role:customer-owner",
      "advance": {
        "kind": "governed-decision",
        "condition": "The accountable owner sends the reply, edits it first, or declines to answer.",
        "decisionScope": "outbound-customer-communication",
        "gate": {
          "authority": "wwwd",
          "mode": "enforced",
          "blocking": true,
          "resolution": "accountable-human",
          "escalation": { "role": "role:customer-owner", "whileWaiting": "hold" }
        }
      },
      "evidence": ["decision-record"]
    }
  ],
  "stopConditions": [
    { "kind": "success", "condition": "No waiting inquiry is without a draft reply.", "disposition": "proceed" },
    { "kind": "failure", "condition": "The inquiry store cannot be read — the run stops and reports, and never drafts a reply to an inquiry it could not read.", "disposition": "inconclusive" },
    { "kind": "budget", "condition": "More than 25 drafts in one run — the run stops and escalates rather than generating a queue nobody can review.", "disposition": "awaiting-person" }
  ],
  "grants": ["tool:read", "tool:workroom_evidence_write"],
  "measures": [
    { "key": "inquiries-drafted", "description": "Waiting inquiries given a grounded draft reply." },
    { "key": "oldest-inquiry-age-days", "description": "Age of the longest-waiting unanswered inquiry." }
  ],
  "budgets": [{ "kind": "findings-per-run", "limit": 25, "unit": "drafts" }],
  "reviewPoint": {
    "everyDays": 30,
    "description": "Reviewed monthly whether or not it moved: an activity that has reported nothing for a month is as likely to be broken as to be reassuring."
  },
  "collaborationShape": "outward-review"
}
```

Where the `gate` block comes from, and why each value:

- It is **proposed**, not decompiled. Today's definition has no such fields. The decompiler takes
  them from a checked-in ratification table (§7.2) keyed by `decisionScope`. This entry is the
  proposal for `outbound-customer-communication`.
- `authority: wwwd`: replying to a customer is the organization's business decision. It matches the
  WWWD authority of the existing `tak-alignment-admit` binding that already covers outward calls.
- `mode: enforced`, `blocking: true`: these describe today's behaviour honestly. The drive refuses
  to execute a `role:` stage and waits for a recorded `decision-record`. Nothing advances the room
  without it.
- `resolution: accountable-human`: the decision is recorded by a person through
  `workroom-stage-decision.ts`. No doctrine resolver decides it.
- No `binding`. The `send` stage declares no platform tools (the person sends), so there is no
  capability set to bind. DRC C-1 passes because no consequential tool is reachable from the stage.
- `escalation.role` repeats the accountable role. Today the decider falls back to the room's
  accountable owner (DI-A76F0C10EF14) when no role binding exists. The fallback stays a runtime
  fact. The document does not pretend a role binding exists.

What compiling this document emits (excerpt):

```ts
// @generated by gpp-shape-compiler 0.1 from
//   apps/web/lib/work-management/shape-documents/inquiry-response-watch.gpp.json
//   sha256:<digest of the canonical document>
// Do not edit. `pnpm --filter web check:gpp-shapes` fails if this file differs from a fresh compile.
import type { WorkShapeDefinition } from "../work-shapes";

export const INQUIRY_RESPONSE_WATCH_1_0_0 = {
  key: "inquiry-response-watch",
  version: "1.0.0",
  // ... every field, in WorkShapeDefinition declaration order ...
} as const satisfies WorkShapeDefinition;
```

TypeScript rather than JSON is emitted on purpose. A JSON import widens `evidence` and
`collaborationShape` to `string`, so `tsc` would stop checking them against their literal unions.
`as const satisfies` keeps the build gate checking emitted shapes exactly as it checks hand-written
ones.

## 5. Iconography and element catalog

The catalog keeps the parent's 15 constructs and adds the exact compile target and the checks for
each. Glyphs derive from BPMN so a modeller recognises them. **Colour never carries meaning.** Every
distinction also has a glyph, a line style or a text label, so the diagram reads in greyscale, in
dark mode and with the org palette (AGENTS.md §9). Node colours come from `--dpf-*` tokens only.

"Exec" says whether the runtime executes the construct today. The compiler refuses to emit a
construct marked **No** (§5.4).

| # | Construct | Icon | BPMN analogue | Meaning | Execution semantics | Compile target | DRC | Exec |
|---|---|---|---|---|---|---|---|---|
| 1 | Trigger | Thin circle with a class glyph: hand (claim), clock (cadence), calendar (deadline-horizon), shield (authority-change), wave (estate-drift), hourglass (evidence-decay), up-arrow (escalation) | Start event (none, timer, conditional, escalation) | What may start an instance | Creates an instance with one token on the start | `triggers[]` | ≥ 1; closed vocabulary; `cadence` needs `reviewPoint` | Yes |
| 2 | Stage | Rounded rectangle. Header is the title; footer is the principal. Corner glyph: cog (`agent:`), person (`role:`), id-card (`person:`) | Task (service / user) | A unit of work with one accountable principal | Active while it holds a token | `stages[i].key`, `title`, `accountablePrincipalRef` | Principal pattern; agent exists in `agent_registry.json`; C-4 | Yes |
| 3 | Capability set | Chip strip on the stage's lower edge, one chip per tool, each with a letter badge R / W / A / O / I | Data input / service interface | The exact tools the stage may reach | The stage's envelope. A stage permit names exactly these tools | `stages[i].tools`; `stages[i].binding` | C-2 every name in `PLATFORM_TOOLS`; C-4 grant held; pin capacity; C-1; C-9 warning if a tool is on the unmediated list | Yes |
| 4 | Gate | Diamond on the stage's exit edge. Inner glyph: column (WWMD), building (WWWD), badge (WSID). Border: solid (enforced and blocking), dashed (shadow), double (enforced, non-blocking). Text label repeats mode | Exclusive gateway after a business-rule / user task | Who decides that the token may leave this stage | §6.2 verdicts. Only `admit` moves the token | `advance = {kind:"governed-decision", condition, decisionScope, gate}` | C-3 exactly one authority; C-7 mode honesty; resolver exists when enforced | Yes (sequential) |
| 5 | Advisory consult | Small diamond in an annotation attached to a gate, same authority glyphs, dotted border, label "advises" | Text annotation + business-rule task | A scope that informs a gate without deciding | Consulted before the gate; result recorded; never changes the verdict | `gate.advisory[]` | Cannot be the only gate on a transition into O / A / I tools | Recorded only |
| 6 | Status transition | Plain solid arrow | Sequence flow | The stage completes on a recorded condition, with no decision | Token moves on a completing evidence receipt | `advance = {kind:"status-change", condition}` | Not allowed into a stage whose capability set has O, A or I tools | Yes |
| 7 | Human checkpoint | Person-with-tick glyph on the gate diamond | User task | A named role must confirm, optionally the exact action | Approval recorded; with `exactAction`, bound to the call's `paramHash` (`apps/web/lib/gpp/param-hash.ts`) | `gate.checkpoint {role, exactAction}`; `resolution: accountable-human` | Role pattern; `exactAction: true` required when the next stage holds I or O tools | Partly (approval exists; per-stage binding is Phase 3b) |
| 8 | Evidence | Document glyph pinned to the stage, label lists kinds | Data output | What the stage must leave behind | Stage cannot complete until a completing receipt exists | `stages[i].evidence[]` | Kinds in `WORK_SHAPE_EVIDENCE_KINDS`; governed stages include `decision-record` | Yes |
| 9 | Stop | Thick circle: tick (success), cross (failure), hourglass (budget); disposition as text | End event (none, error, escalation) | How an instance ends | Consumes all tokens; records the disposition | `stopConditions[]` | ≥ 1 failure and ≥ 1 budget stop (`validateWorkShape`); disposition vocabulary | Yes |
| 10 | Escalation boundary | Up-arrow on the gate's lower point, label names the role | Escalation boundary event (non-interrupting) | Where `hold` and `escalate` go | Emits attention to the role; the token waits | `gate.escalation {role, whileWaiting}` | Role pattern | Yes (attention plan) |
| 11 | Timer | Clock on the stage edge (deadline) or on the frame (review point) | Timer boundary event (non-interrupting) | A deadline or review cadence | Raises an event; never moves or removes a token | `reviewPoint`; `stages[i].deadline` | `reviewPoint.everyDays > 0` | Review point yes; stage deadline **No** |
| 12 | Parallel split / join | Diamond with a plus, label "all" | Parallel gateway | Concurrent branches | Split puts one token on each branch; join waits for all | `flow.nodes` + `flow.edges` | Block-structured; split and join paired (§6.3) | **No** |
| 13 | Rework edge | Dashed back-arrow, label "rework ≤ n" | Sequence flow to an earlier activity (loop) | Return to an earlier stage | Token returns; permits for the stages left are revoked | `flow.edges[].rework.maxIterations`; or `gate.onRefuse` naming an earlier stage | Target is earlier in the same block; bounded | **No** |
| 14 | Sub-shape | Stage with a plus marker at the bottom centre | Call activity | A nested shape | Child instance runs; its stop returns the parent token | `stages[i].subShape` | Child `key@version` resolves; no cycles | **No** |
| 15 | Environment boundary | Dashed container around stages, lock glyph, label names the environment | Group / expanded sub-process | Stages contained by the environment, not per-call mediation | Calls inside run without per-call permits; only `egress` tools reach outside | `binding.enforcement: "environment"`, `binding.egress[]` | Must be declared; `egress` required; undeclared containment is a C-7 violation (GPP Annex C item 5) | Declared only |

Element type seeding: the canvas gets these as EA element types in a GPP notation, seeded the same
way `seed-ea-bpmn20.ts` seeds BPMN (`isExtension: true`, a `GPP__` label prefix). Each GPP type
records its BPMN analogue in its description. Phase 4 adds the renderers next to the BPMN ones.

### 5.4 Never emit what the runtime does not execute

A diagram that shows a parallel branch the runtime runs in sequence is worse than no diagram,
because people act on the picture (GPP §12.4.2). So:

- The schema accepts all 15 constructs. A modeller can draw them.
- The compiler refuses a document that uses a construct marked **No** with
  `E-NOT-EXECUTABLE <construct> at <element id>`. The document stays a draft.
- Each construct's flag flips to Yes only in the PR that teaches the drive to execute it, with a
  test that runs the reference interpreter (§6.5) against the drive for that construct.

This is the same rule GPP §5.4 applies to enforcement: a gate that has not been implemented can
never refuse a call, and a construct that has not been implemented can never be compiled.

## 6. Execution semantics

### 6.1 The restricted token game

The semantics are a token game over a **block-structured, 1-safe** net. They are BPMN 2.0.2
chapter 13 cut down to the constructs above, with no inclusive (OR) joins, no complex gateways, no
event-based gateways and no cancellation regions. That keeps soundness decidable and cheap to
check (van der Aalst et al., 2011).

Definitions:

- An **instance** is a Workroom bound to `shape@version` (the room's existing scope claim, read by
  `readWorkShapeClaim`).
- A **node** is a stage, a parallel split, a parallel join or a stop.
- A **marking** `M` is the set of nodes holding a token. Because the net is 1-safe, a node holds at
  most one token.
- The **flow** is `flow.edges` when present, otherwise the implied sequence
  `stages[0] → … → stages[n-1] → success`.

Rules, applied by the drive one at a time:

1. **Start.** A trigger in `triggers[]` creates an instance with `M = { first stage }`.
2. **Stage enabled.** A marked stage is active. The drive dispatches it as today (agent stages
   dispatch; `role:` / `person:` stages raise an attention plan).
3. **Stage completion.** A marked stage `s` may fire when a completing receipt for `s` exists,
   built from evidence of a kind `s` declares. If `s.advance` is `status-change`, the token moves
   along `s`'s outgoing edge. If it is `governed-decision`, the gate is evaluated first (§6.2).
4. **Parallel split** `p` (when executable): `M := M − {p} ∪ {first node of each branch}`.
5. **Parallel join** `j` (when executable): enabled only when every incoming branch has delivered its
   token. Then `M := M − {incoming tokens} ∪ {successor of j}`. There is no partial join.
6. **Rework edge** `s → t` (when executable): taken only by a gate's `refuse` verdict that names
   `onRefuse: t`, or by an explicit rework edge. It increments a per-edge counter. When the counter
   would exceed `maxIterations`, the edge is not taken; the token goes to the shape's budget stop.
7. **Stop.** When a token reaches a stop, every token in `M` is consumed and the stop's
   `disposition` is recorded. A budget or failure stop may fire from any marking when its condition
   is recorded, as `validateWorkShape` already assumes.
8. **Timers** never change `M`. A stage deadline raises a deadline event. The review point raises a
   review whether or not `M` changed.

What is ruled out, and why:

| Excluded | Reason |
|---|---|
| Inclusive (OR) join | Needs non-local knowledge of which branches might still arrive. Soundness becomes expensive and the behaviour hard to explain. |
| Complex gateway | Arbitrary merge condition; not executable in Camunda 8 either. |
| Event-based gateway | A race between events. Not needed by any current shape. |
| Cancellation region / interrupting boundary event | Makes soundness undecidable (reset arcs). A stop already ends the instance. |
| Data-based exclusive choice | Branches would depend on runtime data the compiler cannot check. The only choice is the gate's verdict. |
| Multi-instance | Not needed by any current shape. A later version can add it as a bounded construct. |

### 6.2 Gates

A gate is evaluated when the stage it sits on has a completing receipt.

- **Verdicts.** Exactly one of `admit`, `hold`, `escalate`, `refuse` (GPP §7.2).
  - `admit`: seal the decision, move the token along the outgoing edge.
  - `hold`: the token stays. Missing evidence is requested.
  - `escalate`: the token stays. Attention goes to `gate.escalation.role`.
  - `refuse`: the token goes to `gate.onRefuse` if declared; otherwise the token stays and the room
    is held for its owner. A refuse never defaults to admit.
- **Mode.** `enforced` means only `admit` moves the token. `shadow` means the verdict is recorded
  and the token moves on the stage's completing receipt alone, as for a status change. The
  recorded shadow verdict is the GPP M-6 divergence sample.
- **Blocking.** `blocking: false` with `mode: enforced` is allowed only for a gate whose refusal is
  recorded and surfaced but does not stop the token. It exists because Build Studio has such gates
  (Annex C, the ship gate outside `enforce` mode). DRC rule D-6 forbids it on a transition into
  O / A / I tools.
- **Advisory consults** run before the gate. Their result is recorded with the decision and never
  changes the verdict.
- **Today's vocabulary.** The stage decision recorded by a person today uses `accept`, `patch`,
  `defer` (`STAGE_DECISION_CHOICES` in `workroom-stage-decision.ts`), and the drive does not route
  on the choice. Phase 3b maps `accept → admit` and `defer → hold`. `patch` stays inside the stage
  (the person amends and accepts). The mapping is part of the gate ratification (§7.2). Until
  `onRefuse` is executable, no compiled shape routes a refusal, so today's behaviour is kept.

### 6.3 Soundness and design rules the semantics need

Because flow is block-structured, soundness is checked structurally, in linear time:

- **S-1 Reachability.** Every node is reachable from the start.
- **S-2 Option to complete.** From every node, a stop is reachable without passing a join that a
  sibling branch cannot reach.
- **S-3 Proper nesting.** Every `parallel-split` has exactly one `parallel-join` that `pairs` it.
  Branches between them do not leave the block except through the join.
- **S-4 No dead stage.** Every stage lies on some path from the start to a stop.
- **S-5 Bounded loops.** Every cycle contains a rework edge with `maxIterations`.
- **S-6 Failure and budget exits.** At least one failure and one budget stop exist
  (`validateWorkShape`).

Block structure plus S-1…S-6 gives a sound, 1-safe workflow net. A sequential shape (no `flow`)
satisfies all six by construction, which is why every decompiled shape passes.

### 6.4 Binding gates to TAK and to GPP permits

The pairing (GPP §7.3) keeps two questions apart. The gate answers "may this class of action
begin?". TAK answers "is this tool in the envelope for this actor in this stage?". The compiler
gives each side exactly what it reads:

| Runtime consumer | What the compiler emits | Existing code |
|---|---|---|
| Drive | The `WorkShapeDefinition`, including typed `gate` | `resolveDrivePlan`, `nextStageKey` |
| Dispatcher tool pin | `stages[i].tools` | dispatcher pin, checked by `stage-tool-parity.test.ts` |
| TAK intersection | Nothing new. Agent grants ∩ principal capability ∩ token scope still decide reach | `filterToolsForCoworkerRuntime` |
| Reference monitor | Binding records (below) | `governedExecuteTool` → `resolveMonitorPermit` → `decidePermitEnforcement` |
| Enforced set | **Nothing.** The compiler never writes `GPP_BINDING_ENFORCEMENT` | `binding-enforcement.ts` |

**Envelope at an instant** = ∪ over marked stages of `tools`, ∩ TAK effective permission. With one
token this is the active stage's tools, as today.

**Binding records.** For each stage with a `binding` whose `tools` include an O, A or I tool, the
compiler emits a record in the `GppBinding` shape (`bindings.ts`):

```ts
{
  bindingId: "<binding.id>",
  version: <binding.version>,
  gateKey: "<gate.gateKey ?? decisionScope>",
  authority: "<gate.authority>",
  resolver: <gate.resolver>,            // required; D-7 refuses an enforced binding without one
  admission: "stage-gate-admit",        // new GppBindingAdmission member
  attach: { shapeRef: "<key>@<version>", stageKey: "<stage.key>" },   // new optional field
  tools: [<the stage's O/A/I tools>],   // always a list, never a predicate
  toolPredicate: (tool) => tool.consequential,
  reason: "oai",
}
```

Two additions to `bindings.ts` are needed: the `"stage-gate-admit"` admission and the optional
`attach`. Both are interface changes in BI-69415B68's code. They ship in a slice coordinated with
that item, and every emitted binding starts in `KNOWN_SHADOW_BINDINGS`.

**Stage permits.** When a gate admits and its stage's binding exists, the gate's admit mints a
permit with `shapeRef`, `stageKey`, `bindingId@version`, `gateDecisionId` and the stage's O / A / I
tools as `capabilities`, through the existing `mintShadowPermit` path. It expires at stage exit,
on rework, on revocation or at `GPP_PERMIT_TTL_MS`, whichever is first. In shadow (the only mode
until a reviewed PR promotes the binding), the monitor records the verdict and refuses nothing,
exactly as Phase 2 does for its two bindings.

**Binding revision.** A new document version is classified by `diffWorkShapeBinding` over the two
emitted definitions. Narrowing and making-explicit changes may apply to pinned rooms (GPP §2.1.1).
A widening change needs a new binding version and a governed rebind (`planWorkroomShapeRebind`).

### 6.5 Reference interpreter

The semantics are also written as a small pure function, `stepShapeInstance(definition, marking,
event) → marking`, in `apps/web/lib/gpp/shape-language/interpreter.ts`. It is not a second
runtime. It is the executable statement of §6.1, used three ways:

- A property test checks that for every sequential compiled shape and any receipt sequence, the
  interpreter's next stage equals `nextStageKey`'s.
- The compiler uses it for soundness checks on explicit `flow`.
- A construct's **Exec** flag flips only when the drive matches the interpreter for that construct.

## 7. The compiler (the CAM step)

### 7.1 Pipeline

```text
<key>.gpp.json
   │ 1 parse          strict JSON; reject duplicate keys and BOM
   ▼
   │ 2 schema         Zod schema (= published JSON Schema); unknown fields fail
   ▼
   │ 3 resolve        tool names → PLATFORM_TOOLS; agents → agent_registry.json;
   │                  evidence kinds; consequence class via classifyConsequentialTool;
   │                  subShape refs; gate resolvers → exported functions
   ▼
   │ 4 design rules   C-1 C-2 C-3 C-4 C-7 C-9(warn) · C-5 (not evaluated) · S-1…S-6 ·
   │                  D-1…D-8 · E-NOT-EXECUTABLE
   ▼  pass
   │ 5 emit           generated/<key>.shape.generated.ts · shape-bindings.generated.ts ·
   │                  gate-ratification-report.json · EA projection desired model
   ▼
   │ 6 classify       diffWorkShapeBinding(previous emitted, new emitted)
   ▼
   │ 7 integrity      `check:gpp-shapes` recompiles everything and byte-compares (CI)
```

The compiler is a pure TypeScript module under `apps/web/lib/gpp/shape-language/`
(`parse.ts`, `schema` (`gpp-shape-schema.ts`), `resolve.ts`, `drc.ts`, `soundness.ts`,
`emit.ts`, `decompile.ts`, `interpreter.ts`). The command is a script in the route-manifest pattern:

- `pnpm --filter web exec tsx scripts/build-gpp-shapes.ts` writes the generated files.
- `pnpm --filter web exec tsx scripts/build-gpp-shapes.ts --check` fails if any generated file
  differs from a fresh compile. Exposed as `build:gpp-shapes` / `check:gpp-shapes`.

### 7.2 Design-rule checks

Each finding has a rule id, a severity, the element id and a message. Errors stop emission.

| Rule | Severity | Fails when | Reuses |
|---|---|---|---|
| C-1 Stage coverage | error | An agent stage of a cadence shape declares no `tools` and is not on `KNOWN_STAGE_TOOL_GAPS`; or a stage's tools include O / A / I and no gate guards entry to it | `stage-tool-parity.test.ts` logic |
| C-2 Vocabulary resolution | error | A tool name is not in `PLATFORM_TOOLS` | same |
| C-3 Scope ownership | error | A `gate` has no authority (schema) or the stage declares two gates | schema |
| C-4 Accountable authority (grant held) | error | The stage's accountable agent holds no grant a declared tool requires | `getAgentToolGrantsAsync` path used by the parity test |
| C-5 Co-occurrence | info: **not evaluated** | Always, until capability tags exist on main. Never reported as pass | — |
| C-6 Reach reconciliation | n/a at compile | Runtime check; the compiler emits the declared envelope it compares against (§9.3) | — |
| C-7 Mode honesty | error | `binding.enforcement: "enforced"` without an entry in `GPP_BINDING_ENFORCEMENT`; or `gate.mode: "enforced"` on a gate whose resolver is missing; or containment declared nowhere for a stage the build sandbox runs | `binding-enforcement.ts` |
| C-8 Transition path uniqueness | info | Reported per transition with the ratchet that guards it (`direct-phase-writes-ratchet.test.ts` for Build Studio; the drive is the only path for work shapes) | existing ratchets |
| C-9 Unmediated reach | warning | A declared tool has a call site on the shrink-only unmediated list | `unmediated-execute-sites.ts`, `critical-interaction-map.ts` |
| S-1…S-6 | error | §6.3 | interpreter |
| D-1 Status into O/A/I | error | A `status-change` advance leads into a stage whose tools include O, A or I | |
| D-2 Advisory only | error | A transition into O / A / I is guarded only by advisory consults | |
| D-3 Checkpoint exactness | error | The next stage holds I or O tools and the gate's checkpoint lacks `exactAction: true` | |
| D-4 Decision evidence | error | A governed-decision stage does not declare `decision-record` (else `governedDecisionStage` returns null and no person can decide it) | `workroom-stage-decision.ts` |
| D-5 Environment egress | error | `enforcement: "environment"` with no `egress` (schema) or an `egress` tool that is unregistered | |
| D-6 Non-blocking enforced gate | error | `blocking: false` on a transition into O / A / I | |
| D-7 Resolver exists | error | An enforced gate or a binding names a resolver module/export that is not an exported function | `bindings.test.ts` rule |
| D-8 Unratified gate | error | A `gate` value differs from the ratification table entry for its `decisionScope` | ratification table |
| E-NOT-EXECUTABLE | error | §5.4 | |
| W-ORPHAN-LAYOUT | warning | A sidecar id matches no element | |

**Gate ratification table.** `apps/web/lib/gpp/shape-language/gate-ratification.ts` maps each of
the 50 current `decisionScope` strings to a proposed `{ authority, mode, blocking, resolution }`
and a status (`proposed` | `ratified` with a DI id). The decompiler fills `gate` only from a
`ratified` entry. A shape whose scopes are not all ratified is not migrated (§10). This is how the
parent's "reported for founder ratification" step becomes a reviewable file rather than a
judgment buried in a converter.

### 7.3 Decompiler

`decompile(definition) → document` is the inverse of emit:

- Copies every current field verbatim, in the schema's order.
- Never emits `flow` (every current shape is sequential).
- Adds `gate` only from a ratified table entry; otherwise leaves the advance untyped and the shape
  is reported "awaiting ratification".
- Emits no `binding`, `deadline` or `subShape`, because no current shape has them.
- Emits no layout. The canvas lays out a sidecar-less document with elkjs on first open and saves
  the result as the sidecar.

### 7.4 Determinism and losslessness

| Property | Statement | Test |
|---|---|---|
| D (determinism) | `compile(D)` is byte-identical across runs, hosts and input key order | Compile each document twice, once with keys shuffled; compare bytes. Uses `canonicalJson` (`@dpf/integration-shared/canonical-json`), stable sorts, no timestamps, LF only |
| L1 (code round trip) | For each of the 51 definitions `S`: `legacy(compile(decompile(S))) ≡ S` under `canonicalJson`, where `legacy` drops only the new optional fields | Vitest over `listWorkShapes()` and `WORK_SHAPE_PRIOR_VERSIONS` |
| L2 (document round trip) | For each document `D`: `decompile(compile(D)) ≡ D` | Vitest over every committed document and the DRC fixture corpus's passing documents |
| R (ratification report) | Every new typed field L1 drops is listed in `gate-ratification-report.json` by shape, stage and value | Snapshot test |

L1 proves the document format loses nothing that runs today. L2 proves the emitted definition
loses nothing the document says. Together they mean the document is a faithful second notation
for the same object, not a second source of truth.

### 7.5 Where things live after migration

- A migrated shape's hand-written constant is deleted. Its generated module is spread into
  `ALL_SHAPES` through `generated/index.generated.ts`.
- `shape-key-parity.test.ts` gains a check that no key is both hand-declared and generated.
- Hand edits to generated files fail `check:gpp-shapes` in CI (a workflow modelled on
  `audit-route-manifest.yml`) and in a vitest test, so the fast local gate catches them too.

## 8. Interchange exports

Exports are produced from the compiled model and are never read back as source.

- **BPMN 2.0 subset.** Processes, service / user tasks, exclusive and parallel gateways, start /
  end / timer / escalation events, sequence flows, plus `gpp:` extension elements for gate
  authority, mode, binding and capability set. Emitted by a small serializer in the compiler. No
  `bpmn-moddle` dependency (§13).
- **SysML v2 textual notation.** Following the GPP §12.2 profile: the shape as an `action def`,
  stages as actions, gates as `requirement def`s, capability sets as ports. Emitted as text.

Both land in Phase 4 at the earliest; neither is on the Phase 3 critical path.

## 9. Design view and runtime view (GPP V-1…V-4)

### 9.1 Shared identifiers (V-3)

Element ids are derived, so the same id exists in the document, the emitted definition, the EA
projection and the runtime receipts:

| Element | Id |
|---|---|
| Shape | `shape:<key>@<version>` |
| Trigger | `trigger:<class>` |
| Stage | `stage:<stageKey>` |
| Gate | `gate:<stageKey>` |
| Capability chip | `tool:<stageKey>:<toolName>` |
| Binding | `binding:<bindingId>@<version>` |
| Stop | `stop:<kind>:<n>` (1-based ordinal among stops of that kind, in document order) |
| Flow node / edge | `node:<id>` / `edge:<from>-><to>` |

The EA projection writes `EaElement.infraCiKey = "gpp:<key>:<elementId>"` through
`applySysmlModel`, with `properties.shapeVersion`. Receipts already carry `stageKey`. Permits
carry `shapeRef` and `stageKey`. So a reviewer can go from a receipt or permit to its model element
and back.

### 9.2 Design view (V-1) and runtime view (V-2)

- **V-1.** The EA canvas renders a document and its sidecar without running any work. Phase 4 adds
  the GPP element types (§5) and a typed property editor bound to the schema. Save runs the DRC
  and shows findings on the elements they name.
- **V-2.** The room shape view (`shape-projection.ts` → `WorkroomShape.tsx`) keeps its two rules:
  verdicts are read off receipts, never inferred, and liveness is passed in. It gains the stage's
  gate authority, gate mode and binding mode from the compiled definition, and links each node to
  its design element by id.

### 9.3 Divergence (V-4)

Divergences attach to the element ids above and appear in both views:

| Divergence | Detected by | Surfaced as |
|---|---|---|
| C-6 reach | A tool was called in a stage that does not declare it (from tool-execution records with `stageKey`) | `EaConformanceIssue` on `tool:` or `stage:`; a gap marker on the room node |
| C-8 transition | A transition happened by a path that skipped a declared gate (for example `gpp-c8-transition-gate-skipped`) | Issue on `gate:`; marker on the room edge |
| Version | A room pins `key@version` that is neither current nor in `prior/` | Existing `work_shape_version_mismatch` deviation (`workroom-shape-conformance.ts`) |
| Mode | A gate shown as enforced whose recorded verdicts are all shadow | C-7 issue on `gate:` |

A view never infers a verdict that the records do not hold. BI-FA970AE2's architecture drift lands
on the same issue records, so a reviewer sees both kinds of gap in one place.

## 10. Migration without behaviour change

Shapes stay code-declared until each one passes. There is no flag day.

1. **Phase 3a** ships the schema, the decompiler and L1 as a test over all 51 definitions. Nothing
   is migrated. The test proves every current shape *can* be expressed.
2. **Ratify gates.** The ratification table is reviewed in batches by owning scope. Each batch is a
   small PR citing a WWMD decision.
3. **Migrate a shape** in its own PR:
   - commit `<key>.gpp.json` (decompiled) and its generated module;
   - delete the hand-written constant;
   - the PR must show L1 equality for that shape, an unchanged `diffWorkShapeBinding`
     classification (`unchanged`) against the previous definition, and every existing work-shape
     test passing without edits.
4. **Prior versions** migrate after their current version, into `shape-documents/prior/`.
5. A shape that fails any check stays hand-declared, listed on a shrink-only
   `KNOWN_UNMIGRATED_SHAPES` list with a reason, in the `KNOWN_STAGE_TOOL_GAPS` pattern.

Because the emitted definition equals the old one field for field, the drive, dispatcher, room
projection, rebind planner and conformance checks see no change. Typed gate fields are optional
and no runtime reader consumes them until Phase 3b.

## 11. Phased delivery and backlog

| Phase | Outcome | Gate to finish | Backlog |
|---|---|---|---|
| 3a | Zod schema and published JSON Schema; decompiler; L1 test over 51 definitions; ratification table populated as `proposed` | AC-SCHEMA, AC-LOSSLESS | BI-6DA17863 slice 1 |
| 3b | Compiler (parse, resolve, DRC, soundness, emit), reference interpreter, `build:gpp-shapes` / `check:gpp-shapes`, CI workflow; first shapes migrated after ratification; emitted binding records in shadow (with the `bindings.ts` additions coordinated with BI-69415B68) | AC-DETERMINISM, AC-EMIT-INTEGRITY, AC-DRC, AC-NOT-EXECUTABLE, AC-INTERPRETER, AC-NODISRUPT | BI-6DA17863 slice 2; touches BI-69415B68 |
| 3c | Runtime execution of parallel split/join, rework, stage deadline and sub-shape in the drive, one construct per PR, each flipping its Exec flag | Interpreter parity per construct | **New BI needed** (drive changes are not notation work); BI-580A970A's per-target fork is its first consumer |
| 4 | Canvas: GPP element types and renderers, typed property editor, DRC on save, sidecar round trip with `EaView.canvasState`, EA projection with shared ids, V-2 overlay, V-4 surfacing; BPMN-subset and SysML v2 export | AC-SHARED-ID | BI-6DA17863 slice 3 (parent called it slice 2); feeds EP-MBSE-WORKROOM-SPINE. A separate BI is advisable for the canvas UX so this item can close on the compiler |
| 5 | Build Studio as one declared shape: a hand-authored document for ideate → plan → build → review → ship, with the plan → build gate set taken from `PLAN_TO_BUILD_GATE_PROFILES` and the build sandbox declared as an environment boundary | GPP Annex C steps 1 and 4 | **New BI needed** (the parent names it) |

## 12. Objectives and acceptance (scope baseline for BI-6DA17863)

These statements are the machine-readable scope baseline for BI-6DA17863, covering Phases 3a, 3b
and the identifier contract that Phase 4 builds on. Phase 3c and Phase 5 get their own items.

- **OBJ-NOTATION:** Every one of the 15 GPP constructs has a defined icon, meaning, execution semantics and a home in a published draft 2020-12 JSON Schema for the shape document.
- **OBJ-SEMANTICS:** The runtime executes exactly the token semantics the document declares, and the compiler never emits a construct the runtime does not execute.
- **OBJ-COMPILE:** A shape document compiles deterministically into the WorkShapeDefinition the runtime reads, and the committed generated files can only change through the compiler.
- **OBJ-LOSSLESS:** Every currently registered shape definition, current and frozen prior, decompiles to a document and recompiles to an identical definition.
- **OBJ-DRC:** The compiler refuses a document that fails the schema, a GPP check it can evaluate, or a soundness rule, and reports checks it cannot evaluate as not evaluated.
- **OBJ-VISIBLE-DESIGN:** Design elements, emitted definitions, EA projections and runtime records share stable identifiers, so divergences can be attached to the same element in both views.
- **OBJ-NODISRUPT:** Migrating a shape to a document changes no runtime behaviour and adds no refusal.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-SCHEMA | OBJ-NOTATION, OBJ-LOSSLESS | All 47 current and 4 prior shape definitions decompile to documents that validate against the committed JSON Schema, and the committed schema equals the one generated from the Zod schema. |
| AC-LOSSLESS | OBJ-LOSSLESS, OBJ-NODISRUPT | For all 51 definitions, recompiling the decompiled document yields a definition equal to the original under canonical JSON once the new optional fields are dropped, and every dropped field is listed in the ratification report. |
| AC-DETERMINISM | OBJ-COMPILE | Compiling each committed document twice, once with its object keys shuffled, produces byte-identical generated files. |
| AC-EMIT-INTEGRITY | OBJ-COMPILE | The check:gpp-shapes command and its vitest twin fail when a generated file is hand-edited or stale and pass on the main branch at merge. |
| AC-DRC | OBJ-DRC | A fixture corpus with one seeded violation per rule (C-1, C-2, C-3, C-4, C-7, S-1 to S-6, D-1 to D-8) is refused with that rule id and element id, and C-5 is reported as not evaluated rather than passed. |
| AC-NOT-EXECUTABLE | OBJ-SEMANTICS, OBJ-NODISRUPT | A schema-valid document that uses a parallel split, rework edge, stage deadline, sub-shape or refuse edge is refused with E-NOT-EXECUTABLE while that construct's executable flag is off. |
| AC-INTERPRETER | OBJ-SEMANTICS | For every sequential compiled shape and generated receipt sequences, the reference interpreter's next stage equals the drive's nextStageKey result. |
| AC-SHARED-ID | OBJ-VISIBLE-DESIGN | Every element of a compiled shape has a derived identifier that the EA projection writes as its infraCiKey and the room shape view uses for the same node, and a seeded C-6 divergence appears on that element in both views. |
| AC-NODISRUPT | OBJ-NODISRUPT, OBJ-COMPILE | After a shape is migrated, getWorkShape and getWorkShapeVersion return a definition equal to the pre-migration one, its binding diff classification is unchanged, and the existing work-shape tests pass without edits. |

## 13. Research and benchmarking

The parent's §7 compares BPMN 2.0.2, WS-BPEL / WS-HumanTask, CMMN / DMN, SysML v2 / KerML, workflow
nets / YAWL, AWS Step Functions ASL, CNCF Serverless Workflow, Microsoft Agent Framework, object
capabilities, token formats, AP2 and credential brokers. Those adopt/reject decisions stand. The
table below adds only what is new for the compiler.

| Reference | What it is | DPF adopts | DPF rejects |
|---|---|---|---|
| **bpmn-moddle** ([GitHub](https://github.com/bpmn-io/bpmn-moddle), MIT) | Reads and writes BPMN 2.0 XML against the BPMN meta-model | The idea of validating an export against the meta-model, done by our own round-trip test of the subset we emit | Adding it as a dependency. It would serve only the export, which is not the source of truth (§7 absorb, don't adopt) |
| **bpmn-js** ([licence](https://bpmn.io/license/)) | BPMN modeller | Glyph conventions only | Embedding it: the licence requires its watermark to stay fully visible. The parent already rejected it; restated because Phase 4 is the point where the temptation returns |
| **bpmnlint** ([GitHub](https://github.com/bpmn-io/bpmnlint)) | Configurable lint rules over BPMN diagrams, shown in the editor | Rule-id'd findings attached to diagram elements, shown while modelling; this is the shape of the DRC output and the canvas's DRC-on-save | The tool itself: its rules are about BPMN hygiene, not authority, capability sets or GPP checks |
| **Camunda 8 BPMN coverage** ([docs](https://docs.camunda.io/docs/components/modeler/bpmn/bpmn-coverage/)) | Which BPMN elements Zeebe executes | The precedent that an engine publishes an explicit executable subset and marks the rest as model-only. That is §5's Exec column and E-NOT-EXECUTABLE. Camunda also leaves complex gateways, compensation, cancel events and transaction sub-processes out of execution | Its broader subset (event-based gateways, multi-instance, event sub-processes): not needed by any current shape, and each widens the soundness problem |
| **AWS Step Functions ValidateStateMachineDefinition** ([API](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinitionDiagnostic.html)); **Amazon States Language** ([spec](https://states-language.net/spec.html)) | Validation of a JSON workflow definition returning diagnostics with severity, code and location, without creating the resource | Diagnostics as data (rule id, severity, element location), ERROR blocks and WARNING does not; validate without deploying | The ASL format and runtime (proprietary, no authority model) |
| **CNCF Serverless Workflow DSL 1.0** ([spec repo](https://github.com/serverlessworkflow/specification)) | A JSON/YAML workflow DSL defined by a versioned JSON Schema | A versioned schema as the published contract, with the format name and version in every document (`format: "gpp-shape/0.1"`) | The DSL itself: no gate, authority or capability-set constructs |
| **JSON Schema draft 2020-12** ([spec](https://json-schema.org/draft/2020-12/)) | The schema standard | The published contract format, so non-TypeScript tools can validate a document | A JSON Schema validator dependency at runtime; Zod already validates in-process |
| **Zod 4 `z.toJSONSchema`** ([docs](https://zod.dev/json-schema)) | Native JSON Schema generation from Zod, draft 2020-12 by default | Generate the published schema from the one Zod definition, so schema and validator cannot drift | `z.fromJSONSchema`, which Zod documents as experimental |
| **SysML v2 / KerML** (OMG adoption announced [July 2025](https://www.omg.org/news/releases/pr2025/07-21-25.htm)); **SysML v2 Pilot Implementation** ([releases](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases)); **SysON** ([project](https://mbse-syson.org/)) | The standard, its reference textual-notation implementation, and a web modeller | Textual notation as an export, checked by parsing in the pilot implementation in a manual verification step, not in CI | SysML as executable source; SysON as a dependency (its site says it is not yet intended for production use) |
| **Workflow-net soundness** (van der Aalst et al., *Formal Aspects of Computing* 2011, [doi:10.1007/s00165-010-0161-4](https://link.springer.com/article/10.1007/s00165-010-0161-4)) | Classification of soundness notions; decidable for workflow nets, undecidable for most extensions including reset arcs (cancellation) | Block structure plus no cancellation, so soundness is a linear structural check (§6.3) | General Petri-net state-space analysis: unnecessary once the net is block-structured |

## 14. Risks

| Risk | Mitigation |
|---|---|
| Documents become a second source of truth beside TypeScript | A migrated shape's hand-written constant is deleted in the same PR; generated files are integrity-checked; a key cannot be both hand-declared and generated |
| A typed gate field misstates today's behaviour (for example "enforced" where the runtime only records) | Gate values come only from a ratified table; D-8 refuses drift from it; C-7 mode honesty; the worked example shows the reasoning per field |
| The diagram shows constructs the runtime does not run | E-NOT-EXECUTABLE; flags flip only with interpreter parity |
| Compiler output churns on unrelated changes | Canonical JSON, stable order, no timestamps; AC-DETERMINISM |
| The DRC re-derives tool or grant rules and drifts from the runtime | DRC calls the same resolvers the parity tests and the monitor use |
| Emitted bindings change monitor behaviour | Every emitted binding starts in `KNOWN_SHADOW_BINDINGS`; the compiler never writes `GPP_BINDING_ENFORCEMENT`; promotion stays a reviewed PR with a WWMD decision |
| Prior versions are forgotten and pinned rooms break | L1 covers all 51 definitions; prior documents migrate into `prior/` |
| Ratifying 50 decision scopes stalls migration | Batched by owning scope; unratified shapes stay hand-declared and keep working; Phase 3a delivers value without any ratification |
| Interface changes to `bindings.ts` collide with BI-69415B68 work | Coordinated slice; additive fields only; that item's tests stay green |

## 15. Out of scope

- Canvas UX polish beyond the element types, property editor and DRC-on-save needed for V-1.
- Organization-authored shapes stored in the database and published through a WWWD gate.
- External submission of the MCP extension (an outward act the parent does not authorize).
- Promoting any binding to enforced.
- Runtime execution of parallel, rework, deadline and sub-shape constructs (Phase 3c, new BI).
- Build Studio as a declared shape (Phase 5, new BI).
- Participant derivation and IT4IT stage placement (EP-MBSE-WORKROOM-SPINE).
- Cleaning up the unused forward-link fields `ValueStreamTeam.eaProcessId`, `bpmnLaneId`,
  `bpmnGatewayId` (`packages/db/prisma/schema/work-coordination.prisma`). They are not needed by
  this design and are left to a separate decision.

## 16. Verification for this slice

This is design documentation only. No code, schema or runtime changes. Doc lint applies. Every
file path and symbol cited above was checked on `origin/main` at `e2d22ad43`, and the shape counts
in §2 come from importing the registry, not from reading comments. Independent design review is
required before Phase 3a.

## 17. Documentation impact

This spec is the documentation change. When Phase 3b lands, GPP §12.4.3 and Annex A move
"Executable model" from code-declared to document-compiled for migrated shapes. That edit belongs
to the implementing PR, not this one.
