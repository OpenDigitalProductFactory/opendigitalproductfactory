---
status: draft
---

# GPP model to execution: notation, compiler and un-bypassable enforcement

| | |
|---|---|
| Date | 2026-10-01 |
| Epic | EP-B932453F |
| Backlog | BI-6DA17863 (notation and compiler), BI-69415B68 (structural enforcement) |
| Workroom | WC-46F2688A |
| Decisions | DI-035897A0F1D6 (notation composition), DI-2DE3951FBB28 (permit representation); both WWMD, high confidence, high stakes |
| Normative owner | [GPP](../../architecture/gated-permissions-process.md). This spec proposes how DPF realizes it. Normative amendments follow review. |

## 1. Founder direction

The founder's direction, from 2026-10-01:

- Visual modeling should become execution the way a CAD model becomes a part on a 3D printer or a
  CNC machine.
- MBSE is the forward-engineering paradigm. Workroom shapes should be seen and modified as a whole
  at design time, then executed by this platform.
- The diagram's iconography, and what each construct *means and does* (in the manner of executable
  languages such as BPEL), must be defined.
- The GPP pair is how a gate couples to action in the tools. The tool interfaces must enforce it by
  design, so that it cannot be bypassed, rather than through prose. That may go beyond what MCP
  defines today.
- MCP's local allow / ask / deny is per tool. GPP is per case and per gate: the WWMD, WWWD and WSID
  layers are the gate, and MCP tool use is the action. Today DPF implements this strongly, but much
  of it is doctrine rather than hard structure.
- Consider proposing a change to MCP that shows enforcement as per-transaction and situational,
  rather than broad scope.

## 2. What exists today

Verified on origin/main at 1ada5f062f.

| Concern | Today | Gap |
|---|---|---|
| Executable shape | `WorkShapeDefinition` in TypeScript (`work-shapes.ts`) has triggers, stages (`accountablePrincipalRef`, `advance`, `evidence`, optional `tools`), stop conditions with disposition, `grants`, budgets, review point and collaboration shape. The runtime reads these constants. | `advance.decisionScope` is a free string naming a decision lane, such as `delivery-merge`. It does not name the owning authority (WWMD/WWWD/WSID), the gate mode, or whether the gate blocks. Stages are sequential by index. There is no parallel/join and no rework edge. |
| EA metamodel | Seeded ArchiMate 4, BPMN 2.0 and SysML v2 element types. `EaView` is the canvas (`@xyflow/react` + elkjs), with custom BPMN node shapes. | Every projection runs code → model (the parity engine). Nothing compiles a model to runtime. BPMN types describe runtime mappings in prose only. There is no GPP element type, no icon registry, no typed property editor, no approval/snapshot workflow, and the palette may not show BPMN types. Dead forward-link fields exist: `ValueStreamTeam.eaProcessId`, `bpmnLaneId`, `bpmnGatewayId`. `projectArchetypeRoomDefinitions` has no production caller. |
| Gate → tool coupling | Five separate mechanisms: the room envelope (enforced), the WWWD×WSID alignment gate (enforced), the escalation gate (enforced), the shape gate (shadow), and the decision → exact-action projector (11 tools). | The decision side and the permission side meet by convention. There are 33 non-test direct `executeTool(` call sites outside the governed path, and a known transition bypass (BI-45F9CB7A). |
| Permit substrate | Approval binding fingerprints (`authority-approval-envelope.ts`), time-bound projected authorizations (`policy-authority-projector.ts`), and mandatory receipt reservation. | Not required on every effect-producing call, and not carried across MCP. |

## 3. Design overview: the CAD → CAM → machine chain

| Manufacturing | DPF |
|---|---|
| Model-based definition: geometry plus manufacturing information | **GPP shape model**: stages, gates with owning authority and mode, capability sets, checkpoints, evidence, stops |
| Design-rule / DFM check | **Design-rule check (DRC)**: GPP C-1…C-8, workflow-net soundness, co-occurrence C-5, loop budgets |
| CAM + post-processor | **Compiler**: model → `WorkShapeDefinition` + binding records + layout sidecar + EA projection |
| G-code on the controller | **Bindings and permits enforced at the reference monitor** |
| Digital thread | Model element id → binding version → gate decision → permit → tool call → receipt |
| Digital twin | The live room drawn on the same diagram (GPP V-2, V-3) |

Three properties make the chain trustworthy:

1. **Determinism.** The same model always compiles to the same executable shape.
2. **Losslessness.** Decompiling an existing shape and recompiling it reproduces it exactly.
3. **Enforcement where it matters.** For critical tools (outward, authority, irreversible) under an
   enforced binding, a tool is unreachable unless a live permit minted by the stage's gate names it.
   Other tools keep today's grant checks (§5.0).

## 4. Part I: The GPP shape language

### 4.1 Source of truth and format (DI-035897A0F1D6)

The canonical source is a **versioned GPP shape document**: JSON validated by a published JSON
Schema. It is a strict superset of `WorkShapeDefinition`, so every existing field has a home and the
47 current shapes convert without loss. A separate **layout sidecar** holds diagram positions, so
layout edits never change semantics.

- **Platform shapes** live in the repository, governed by PR (WWMD).
- **Organization-authored shapes** (later phase) live in the database and are published through a
  governed WWWD gate.
- **Export** to a BPMN 2.0 subset (with `gpp:` extension elements) and to SysML v2 textual notation
  is provided for interchange. Export is not the source of truth.

### 4.2 Element catalog: icon, meaning, execution semantics, compile target

The icons derive from BPMN so that modellers recognise them. Each icon is a typed glyph with defined
behavior. Colour never carries meaning on its own: every distinction also has a glyph or a line
style, to meet the theme rule and accessibility.

| # | Construct | Icon (glyph) | Meaning | Execution semantics | Compiles to | DRC |
|---|---|---|---|---|---|---|
| 1 | **Trigger** | Thin circle with a class marker: hand (claim), clock (cadence), calendar (deadline horizon), shield (authority change), drift (estate drift), hourglass (evidence decay), up-arrow (escalation) | What may start an instance | Creates an instance with one token at the first stage | `triggers[]` (closed vocabulary) | At least one trigger; cadence requires a review point |
| 2 | **Stage** | Rounded rectangle. Header: accountable principal. Corner glyph: person (human), cog (coworker), split (shared) | A unit of work with one accountable principal | Active while it holds a token. Only its capability set is reachable (§5). | `stages[i]` (`key`, `title`, `accountablePrincipalRef`) | Accountable principal resolves (C-4) |
| 3 | **Capability set** | Port strip on the stage's lower edge: one chip per tool, badged by consequence class (R read, W write, A authority, O outward, I irreversible) | The exact tools the stage may reach | Defines the stage's binding. A permit for the stage names exactly these tools. | `stages[i].tools` + binding record | Each tool resolves to a registered tool and grant (C-2); C-5 co-occurrence |
| 4 | **Gate** | Diamond. Inner glyph names the owning authority: column (WWMD platform), building (WWWD organization), badge (WSID profession). Border: solid = enforced and blocking; dashed = shadow; dotted = advisory. | Who decides that the next stage's class of action may begin | On arrival, the gate's resolver is consulted and returns admit / hold / escalate / refuse. **Admit** seals a decision and moves the token on. If the next stage holds O, A or I tools, admit also mints that stage's permit. **Hold** keeps the token and requests evidence. **Escalate** keeps the token and routes to the escalation path. **Refuse** follows the refuse edge or stops. | `stages[i].advance` = `{kind:"governed-decision", authority, gateKey, mode, blocking, resolution}` (**new typed fields**) | Exactly one owning authority (C-3); declared mode is honest (C-7); every runtime path for this transition enforces it (C-8) |
| 5 | **Advisory consult** | Small diamond in an attached annotation, same authority glyphs | A scope that informs the gate without deciding | Consulted before the gate. Its result is recorded and never changes the gate verdict. | `advance.advisory[]` (new) | An advisory consult cannot be the only gate on a consequential transition |
| 6 | **Status transition** | Plain arrow | The stage completes on a condition, with no decision | Token moves when the condition is recorded | `advance = {kind:"status-change"}` | Not allowed into a stage whose capability set includes O, A or I without a gate |
| 7 | **Human checkpoint** | Person-with-tick glyph on a gate or transition | A named role must confirm | Exact-action approval. The approval is bound to a hash of the canonical tool name and arguments. | Gate `resolution: accountable-human`, plus `checkpoint.role` | Role resolves; approval binding required for I and O tools |
| 8 | **Evidence** | Document glyph attached to a stage | What the stage must leave behind | The stage cannot complete until the evidence is recorded | `stages[i].evidence[]` | Kinds belong to the recordable vocabulary |
| 9 | **Stop** | Thick circle: tick (success), cross (failure), hourglass (budget) | How an instance ends | Consumes the token and records the disposition | `stopConditions[]` with `disposition` | A failure exit is required; dispositions belong to the closed vocabulary |
| 10 | **Escalation boundary** | Up-arrow on the stage edge | Where a hold or escalate goes, and what happens while waiting | Emits to the accountable role. The token waits at the stage. | `advance.escalation{role, whileWaiting}` (new) | Role resolves |
| 11 | **Timer / review** | Clock on the stage edge or the canvas frame | A deadline or review cadence | Raises a review or deadline event regardless of progress | `reviewPoint`, stage deadline (new) | A review point is required |
| 12 | **Parallel split / join** | Diamond with a plus | Concurrent stages | One token per branch; the join waits for all branches | `stages` graph edges (**new**; today stages are sequential) | Workflow-net soundness: option to complete, proper completion, no dead stage |
| 13 | **Rework edge** | Dashed back-arrow | Return to an earlier stage | Token returns. Permits for the later stage are revoked. | Graph edge with `rework: true` (new) | The loop is bounded by a budget |
| 14 | **Sub-shape** | Stage with a plus marker | A nested shape | Instantiates the child shape; the child's stop returns the token | `subShape: key@version` (new) | Child shape exists; no cycles |
| 15 | **Environment boundary** | Dashed container around stages | Stages whose containment is enforced at the environment layer, such as the build sandbox | Tools inside the boundary run without per-call mediation. Nothing inside can reach outside except through declared ports. | Binding `enforcement: environment` + declared egress ports | Must be explicit. An undeclared environment boundary is a C-7 violation (GPP Annex C, item 5). |

### 4.3 Execution semantics

The semantics are a restricted token game: BPMN chapter 13 cut down to the constructs above, with no
OR-joins and no cancellation regions, so that soundness stays decidable.

1. An instance is a Workroom bound to `shape@version`. It holds a marking: the set of tokens on
   stages.
2. **The envelope at any instant** is the union of the capability sets of marked stages, intersected
   with TAK's effective permission (agent grants ∩ principal capability ∩ token scope). A tool is
   reachable only if a live permit names it (§5).
3. **Leaving a stage** requires its evidence to be recorded and its advance to be satisfied. Gate
   resolution is recorded as a `DecisionInteraction`. Only `admit` moves the token.
4. **Permits** are minted at admit for the next stage and expire at stage exit, on rework, on
   revocation, or at their validity limit, whichever comes first.
5. **Binding revision**, classified per GPP §2.1.1 by diffing compiled envelopes: a narrowing change
   applies to live instances; a making-explicit change applies after C-6 confirms; a widening change
   requires rebinding (BI-CB5C0DCE).

### 4.4 Compiler pipeline

```text
shape document ──parse──▶ AST ──resolve──▶ typed model ──DRC──▶ verdict
                                                         │ pass
                                                         ▼
          emit: WorkShapeDefinition (runtime) · binding records · layout sidecar
                · EA projection with stable element ids (V-1, V-3)
                · BPMN-subset / SysML v2 export (interchange)
          classify change vs previous version: narrow | explicit | widen (§2.1.1)
          publish: PR (platform) or governed WWWD publish (organization)
```

**Acceptance test for the compiler (determinism and losslessness):**

1. Decompile all 47 current shapes and the Build Studio flow into shape documents.
2. Recompile them.
3. The emitted `WorkShapeDefinition`s must equal the originals field for field, except for the new
   typed gate fields, which are reported for founder ratification.

## 5. Part II: Un-bypassable enforcement

### 5.0 Adoption constraints (founder, 2026-10-01)

These four constraints override anything in this part that conflicts with them.

1. **No disruption to current operations.** A tool with no declared binding behaves exactly as it
   does today. The reference monitor records it as "not governed by GPP" and lets it through. A
   permit is required only where a binding declares `enforcement: enforced`, and every binding
   starts in `shadow`. A gate that has not been implemented can never refuse a call.
2. **Gate the critical interactions, not every call.** Permits apply only to stages whose capability
   set includes outward (O), authority (A) or irreversible (I) tools, or which assemble the C-5
   capability combination. Read (R) and ordinary internal-write (W) tools stay on today's TAK
   intersection with no permit. The design view exists to show where these critical edges are, so
   that attention goes to the calls that matter.
3. **Ratchet, don't flip.** Every new structural check ships with today's exceptions on a
   shrink-only list, the same pattern as `KNOWN_STAGE_TOOL_GAPS`. CI breaks only when a *new* hole
   is added, never because of existing ones. No global switch is ever turned on. Build Studio paths
   change only where a defect fix needs it, and each such change ships with a test.
4. **Development reality is stated, not hidden.** On this install, agents can read source and reach
   the database. Until key custody and credential separation are in place (§5.6), DPF *detects*
   permit forgery but does not *prevent* it. Public claims say so.

### 5.1 Principle

For the interactions that matter, the gate is in the call path. Authority becomes a value the call
must carry, not a flag the server reads. Under an enforced binding, a critical tool that no live
permit names is unreachable: it is neither offered nor prompted. Everywhere else, §5.0 applies, and
behavior is unchanged until a binding says otherwise.

### 5.2 The permit (DI-2DE3951FBB28)

**Phase 1: an opaque permit id that references a database row.** The row extends the projector's
authorization record and the approval-binding substrate; schema audit first. Its claim set is the
contract:

| Claim | Purpose |
|---|---|
| `bindingId@version`, `shape@version`, `stage` | What was modelled |
| `gateDecisionId`, `authority` (WWMD / WWWD / WSID) | Who decided |
| `actor` (GAID), `workroom`, `subjectScope` | For whom and over what |
| `capabilities[]`: tool ids, optional argument constraints | What may run |
| `paramHash` (I/O tools after a checkpoint) | Exact-action binding: SHA-256 of canonical (tool, arguments) |
| `enforcement` (`enforced` / `shadow` / `environment`) | Mode honesty |
| `notBefore`, `expiresAt`, `maxUses`, `nonce` | Validity and replay |
| `parentPermitId` | Attenuation chain. A child may only narrow. |
| `revokedAt` | Instant revocation |

**Later:** add a signed, attenuable encoding of the *same* claim set, either Biscuit 3.x or the
RAR-JWT attenuating-token draft. It would be used only where cross-installation federation or
offline sub-agent delegation needs it.

### 5.3 Complete mediation by construction

1. **One reference monitor.** Every effect-producing handler is registered through a registry that
   wraps it in the monitor (`governedExecuteTool`). The registry returns nothing callable, so a
   handler cannot be imported and invoked directly.
2. **Verification order in the monitor**, before any handler runs:
   - permit exists, is unexpired and unrevoked, and has a nonce or uses left
   - tool ∈ capabilities, and argument constraints hold
   - the stage is still marked
   - `paramHash` matches for checkpointed tools
   - TAK effective permission
   - receipt reservation

   Only then does the **credential broker** release the downstream credential.
3. **Static guarantees.**
   - An architectural test enumerates the registry and fails if any side-effecting tool is unwrapped
     or lacks a capability mapping.
   - A dependency rule forbids importing handler modules outside the registry.
   - The 33 direct `executeTool(` sites are routed through the monitor or proven read-only.
   - New check **C-9 unmediated reach**: a side-effecting tool is reachable by a path that does not
     pass the reference monitor.
4. **Transition integrity.** All stage transitions go through one transition function that requires
   the gate decision. This is C-8, and it closes BI-45F9CB7A by construction.
5. **Credentials never reach the agent.** Integration secrets are resolved only inside the monitor
   after verification. Agent-visible context never contains them.

### 5.4 Rollout

Enforcement is per binding, never global:

- **Absent.** There is no binding for this tool in this stage. Today's behavior applies, and the
  call is recorded as "ungoverned".
- **Shadow.** A binding exists. The monitor computes the verdict it would give and records any
  divergence (GPP M-6), but never refuses.
- **Enforced.** Promoted per binding after its shadow evidence is ratified (DI-6D5D686464DC
  pattern). Only O/A/I bindings are ever promoted. R and W tools have no permit requirement to
  promote.

**Ordering.** A binding cannot reach `enforced` until its gate is implemented and emits decisions.
The compiler refuses to publish an enforced binding whose gate has no resolver. A permit therefore
cannot be demanded by a gate that does not exist yet.

### 5.6 Permit integrity: what a tenacious agent cannot fabricate

The permit id travels with the call. It is useful to the transaction only if the monitor can prove
three things: it was minted by the gate, it is unchanged, and it is being used for this call.

- **Handle format.** `gpp1.<permitId>.<keyId>.<mac>`, where
  `mac = HMAC-SHA256(key[keyId], canonical(claims))`. This reuses the existing signing pattern in
  `delegation-receipt.ts` and `reach-link.ts`: a key id plus an environment secret, constant-time
  comparison, and no fallback constant. No new cryptographic dependency is added.
- **Verification.** The monitor loads the row by `permitId`, recomputes the MAC over the row's
  claims, and compares. Editing a row, or inventing one, fails unless the forger also holds the key.
- **Binding to the transaction.** For O/A/I calls the claims include `paramHash`, so a valid permit
  cannot be replayed for different arguments. `nonce` / `maxUses` stop reuse, and `stage` plus
  `workroom` stop reuse elsewhere.
- **Lineage.** Every permit references a `gateDecisionId` whose `DecisionInteraction` is sealed in
  the hash-chained decision ledger (`chainEntryHash`). A permit with no sealed decision behind it
  is invalid even if its MAC verifies.
- **Key custody is the real boundary.** The key lives only in the portal process's secret store.
  It is not in the repository, not in the database, and not in agent-visible context. The
  installation's step-ca is the longer-term custody option. While agents on this development
  install can read host secrets or write to the database directly, forgery is **detectable**
  (MAC failure, a missing sealed decision, a chain break), not **impossible**. Prevention needs
  agent runtimes that hold no database credentials and cannot read the signing key. That is a
  deployment property for production installs, and GPP Annex A must report it per install.

## 6. Part III: Beyond MCP: a transaction-scoped authorization extension

**Gap.**

- MCP 2026-07-28 authorizes at the server and scope level: OAuth 2.1, RFC 8707, RFC 9728.
- Tool annotations are untrusted hints.
- The spec says a server-issued handle "is a name, not a capability".
- None of the 42 Final SEPs defines per-call or per-transaction authorization. Draft and in-review
  SEPs have not been checked.

**Hooks available:**

- the required `_meta` on every request
- `InputRequiredResult` / multi-round-trip requests (SEP-2322)
- URL-mode elicitation (SEP-1036)
- the Extensions framework (SEP-2133)

**Proposal outline: an MCP Extension, "Gated permits (transaction-scoped authorization)".**

- **Capability advertisement.** At initialize, the server advertises `extensions.gatedPermits`, with
  the permit formats it supports.
- **Carriage.** The permit travels in `tools/call` `params._meta["io.opendigitalproductfactory/permit"]`,
  optionally with a proof-of-possession binding the permit to (tool, paramHash, timestamp).
- **Refusal semantics.** A missing or insufficient permit returns a structured `permit_required`
  result naming the gate descriptor (authority, gate key, stage, checkpoint role). It can also
  return `InputRequiredResult` when a human checkpoint is due. It never returns a silent failure.
- **Attenuation rule.** Permits can be narrowed by intermediaries, never widened.
- **Relationship to existing standards.** OAuth scopes still authenticate the client and bound the
  ceiling. The permit authorizes *this call in this stage*. It is compatible with RFC 9396
  `authorization_details` and OAuth Transaction Tokens.

**Sequence.**

1. Implement it in DPF as the reference implementation (Phases 2–3).
2. Draft the SEP with conformance examples.
3. Check the draft and in-review SEPs for overlap.
4. Submit on founder authorization. External submission is an outward act, and this spec does not
   authorize it.

## 7. Research & Benchmarking

Sources are cited in the research briefs recorded with BI-6DA17863 and in the
[market brief](../../architecture/agent-governance-market-landscape-2026.md).

| Reference | What DPF adopts | What DPF rejects |
|---|---|---|
| **BPMN 2.0.2** (OMG / ISO 19510): token execution semantics (ch. 13), BPMN DI, extension elements | Iconography lineage; token semantics restricted to a decidable subset; a BPMN-subset export with `gpp:` extensions | BPMN XML as source of truth: too large a surface, prose semantics, and no permission model. Embedding bpmn-js: modified-MIT licence with a permanent watermark. Camunda 8: a commercial licence is required for production. |
| **WS-BPEL 2.0 / WS-HumanTask** | The lesson that an executable format needs a blessed notation; WS-HumanTask's people model (potential owners, escalation, deadlines) as vocabulary | A transport-coupled XML executable |
| **CMMN 1.1 / DMN 1.5** | CMMN sentry semantics (entry and exit criteria) for gates; DMN-style decision tables for deterministic gate rules where a rule suffices | CMMN notation (adoption stalled) |
| **SysML v2 / KerML** (adopted 2025) | A SysML v2 textual export, and the GPP §12.2 mapping for the systems view | SysML as executable source: no normative executor, and SysON self-describes as pre-production |
| **Workflow nets / YAWL** | A soundness check as the DRC back end | OR-joins and cancellation regions, which make soundness undecidable |
| **AWS Step Functions ASL + Workflow Studio; CNCF Serverless Workflow 1.0** | The one-to-one visual ↔ executable document pattern; a JSON Schema-validated DSL | No governance or authorization model; proprietary runtime (ASL) |
| **Microsoft Agent Framework declarative workflows** (per-action `requireApproval`) | Approval as a node attribute | It does not scope the tools available inside a stage, and it has no owning authority |
| **Object-capability security** (Miller; Capsicum; seL4; WASI 0.2), **CaMeL** | Authority as an unforgeable value; complete mediation (Saltzer & Schroeder) | Value-level data-flow tagging as a GPP requirement (left to TAK runtime work) |
| **Macaroons, Biscuit, UCAN, RFC 9396 / 9449 / 8693, OAuth Transaction Tokens, IETF attenuating-agent-tokens draft** | The attenuate-only claim model; parameter-hash binding; a later signed encoding | Adopting a token library now (DI-2DE3951FBB28) |
| **AP2 mandates; card-network agentic tokens** | The intent → exact-action split, mapped to stage permit → checkpointed exact-action permit | A payment-specific format |
| **Credential brokers** (Auth0 Token Vault, Arcade, OpenBao dynamic secrets) | The agent never holds downstream secrets | A third-party broker dependency (the broker is internal to the monitor) |

## 8. Phased delivery (to be planned with live backlog coverage)

| Phase | Outcome | Backlog |
|---|---|---|
| 0 | This design reviewed; GPP normative amendments drafted: typed gate fields in the binding, §5.3 as normative text, C-9 | BI-6DA17863, BI-69415B68 |
| 1 | **See and ratchet, without blocking.** A critical-interaction map: every O/A/I tool, how it can be reached, and which gate (if any) guards it. An architectural test whose shrink-only allowlist holds today's direct `executeTool` paths. Fix the BI-45F9CB7A transition bypass, with a regression test. **No permit, no new refusal, no Build Studio behavior change otherwise.** | BI-69415B68 slice 1; BI-45F9CB7A |
| 2 | **Permits, shadow only, O/A/I only.** Minted at gate admit with the §5.6 MAC handle, carried in `_meta`, verified and recorded at the monitor, never refusing. Promoted per binding after ratification. | BI-69415B68 slice 2 |
| 3 | **Shape document schema and compiler**, with the decompile/recompile acceptance test over all 47 shapes; typed gate fields added to `WorkShapeDefinition` | BI-6DA17863 slice 1 |
| 4 | **Canvas.** GPP element types and icon registry in EA; typed property editor; DRC on save; governed publish; runtime overlay (V-2) | BI-6DA17863 slice 2; feeds EP-MBSE-WORKROOM-SPINE |
| 5 | **Build Studio as one declared shape** (GPP Annex C steps 1–6) | new BI |
| 6 | **MCP extension.** Reference implementation, SEP draft, founder-authorized submission | new BI |

## 9. Risks

| Risk | Mitigation |
|---|---|
| The notation becomes a second source of truth beside the TypeScript shapes | The compiler emits the runtime definition; hand edits to emitted files fail CI. Decompile/recompile proves no loss. |
| Permit checks add latency or friction | Opaque id lookup with caching; permits are minted per stage, not per call; checkpoints only on I and O tools |
| Shadow mode lingers and enforcement is never switched on | M-6 divergence reported; promotion criteria fixed in advance |
| Breaking external agents | MCP carriage is additive; permits are required first in DPF's own clients; external clients get structured `permit_required` guidance |
| Overclaiming before enforcement | GPP Annex A and the white paper ledger keep per-element mode honest (C-7) |

## 10. Verification for this slice

This is design documentation only. Doc checks run; no runtime change is made. Independent design
review is required before Phase 1.

## 11. Objectives and acceptance (scope baseline for BI-69415B68)

These statements are the machine-readable scope baseline for the structural-enforcement item
(BI-69415B68), which covers design Phases 1 and 2. The notation and compiler work (BI-6DA17863)
gets its own baseline when it is planned.

- **OBJ-NODISRUPT:** No tool call that succeeds today fails because of GPP enforcement unless a binding for that tool and stage has been promoted to enforced after its shadow evidence was ratified.
- **OBJ-CRITICAL:** Permits are required only for outward, authority-changing and irreversible tools, and for C-5 capability combinations, under enforced bindings; read and internal-write tools keep today's checks.
- **OBJ-MEDIATION:** Every side-effecting tool is reachable only through the reference monitor, and every existing exception sits on a shrink-only list.
- **OBJ-TRANSITION:** Every stage transition that a model guards is performed through one transition function that enforces the transition's declared gate set.
- **OBJ-PERMIT:** A permit is minted only at gate admit. It carries a MAC over its claims, is bound to the exact transaction for outward, authority and irreversible calls, and traces to a sealed decision in the hash-chained ledger.
- **OBJ-VISIBLE:** Critical interactions, the gates that guard them and each gate's enforcement mode are visible on demand and reported honestly.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-RATCHET-CLASS | OBJ-VISIBLE, OBJ-CRITICAL | A test fails when a new side-effecting tool is added without a consequence class, and passes on the main branch at the time of merge. |
| AC-RATCHET-REACH | OBJ-MEDIATION | A test fails when a new direct executeTool call site is added outside the reference monitor, and passes on the main branch at the time of merge. |
| AC-MAP | OBJ-VISIBLE | The critical-interaction map lists every registered tool exactly once with its consequence class, guards, guard modes and direct call sites. |
| AC-C8-SHADOW | OBJ-TRANSITION, OBJ-NODISRUPT | When save_phase_handoff advances a build from plan to build, a gate-skipped event is recorded and the transition outcome is unchanged. |
| AC-SHADOW-PERMIT | OBJ-PERMIT, OBJ-NODISRUPT | In shadow mode the monitor records a permit verdict for every outward, authority and irreversible call under a binding and refuses none. |
| AC-FORGERY | OBJ-PERMIT | A permit whose row was edited or invented fails MAC verification and is recorded as forged. |
| AC-ENFORCE | OBJ-CRITICAL, OBJ-NODISRUPT | A tool under an enforced binding is refused without a valid permit, while tools without a binding behave exactly as before. |
| AC-SINGLE-TRANSITION | OBJ-TRANSITION | Every code path that performs a governed stage transition calls the shared transition function. |
