# Decision Perspective Experience Layer Design

| Field | Value |
| --- | --- |
| Date | 2026-05-31 |
| Status | Draft for implementation planning |
| Primary epic | EP-WWMD-MCP |
| Backlog items | BI-188950EA, BI-D9F8D35E, BI-1BF0F1D9, BI-141B574A, BI-6C6AD644 |
| Related specs | 2026-05-17-wwmd-decision-perspective-kernel-design.md, 2026-05-19-wwmd-mcp-exposure-design.md, 2026-05-12-principles-as-wiki-kind-design.md, 2026-05-09-wiki-visual-navigation-design.md, 2026-05-09-wiki-ppr-retrieval-design.md |
| Related plan | ../plans/2026-05-31-wwmd-explainability-layer.md |

## 1. Purpose

The Decision Perspective substrate already has the hard parts of a governed decision system: profile material, `DecisionInteraction`, `PerspectiveMaterial`, `WikiPage`, `WikiPageLink`, `RawSource`, principle retrieval, `principle_decide`, and the in-flight MCP exposure work. What it does not yet have is an operator-readable experience layer that makes a decision inspectable instead of oracle-like.

This design adds an Obsidian-inspired experience layer to profile-aware decisions:

- a Decision Canvas for a single profile-backed decision
- a backlinks-style panel for every surfaced principle
- a review inbox for unresolved gaps
- a conservative research capture path into `RawSource`

The design borrows Obsidian's linked-thinking patterns but keeps DPF's governed data model as the source of truth. Obsidian, exported Markdown, web clips, or local notes are never authoritative decision material by themselves.

The decision aspect is primary. The experience layer explains, audits, routes, and improves decisions after the decision engine has done its work.

## 1.1 WWMD and WWWD

WWMD and WWWD should be two profiles on the same decision substrate, not two duplicated systems.

| Mode | Meaning | Governs | Example |
| --- | --- | --- | --- |
| WWMD | What Would Mark Do? | DPF platform doctrine: architecture, engineering, governance, Build Studio, agent behavior | Should an agent bypass a build gate? |
| WWWD | What Would We Do? | Organization-local doctrine: policies, business preferences, customer commitments, operating choices | Should this HVAC company comp a customer after a late appointment? |

Shared substrate:

- `DecisionPerspectiveProfile` selects the voice/doctrine being applied.
- `PerspectiveMaterial` stores approved/candidate material for that profile.
- `DecisionInteraction` records the decision event.
- Decision Canvas renders any profile-backed decision.
- Capture/review surfaces produce candidate material for the selected profile.

Boundary rule:

> WWMD governs the platform. WWWD governs the business using the platform.

When a business decision would also change platform behavior, WWWD can recommend the business choice, but WWMD still governs the platform implementation path.

## 2. Research and Benchmarking

Obsidian's useful product pattern is not "notes as authority"; it is "plain linked objects are easy to inspect." Official Obsidian docs describe:

- Bases as database-like views over local Markdown files and properties: <https://obsidian.md/help/bases>
- Graph view as a visual map of note relationships: <https://obsidian.md/help/plugins/graph-view>
- The help index's Web Clipper, Sync, and Publish surfaces as capture, synchronization, and publishing affordances: <https://obsidian.md/help/>
- Canvas as a spatial arrangement surface stored in open JSON Canvas files: <https://obsidianmd-obsidian-help.mintlify.app/plugins/canvas>

Patterns to adopt:

| Obsidian pattern | DPF adaptation |
| --- | --- |
| Backlinks | Show which wiki pages, prior decisions, and sources explain why a principle or material surfaced. |
| Local graph | Show a bounded principle neighborhood rather than a full kernel hairball. |
| Canvas | Render one decision as options, doctrine/material pulls, evidence, risks, and outcome. |
| Bases | Provide sortable/filterable decision and principle tables using existing records. |
| Web Clipper | Capture outside material as `RawSource` candidates, not as active doctrine. |

Patterns to reject:

| Pattern | Reason |
| --- | --- |
| Personal vault as runtime source | Violates single source of truth, review, privacy, and tenant governance. |
| Global graph as default UX | Large graphs are often pretty but weak for task completion. DPF should default to bounded local context. |
| Free-form note plugins as platform substrate | DPF already has typed records, scopes, citations, revisions, and audit. |

## 3. Current Substrate

Verified repo and live backlog context:

- `EP-WWMD-MCP` owns the active WWMD MCP exposure work and is the current delivery home for the shared decision experience layer.
- Sprint 1 backlog items cover fingerprinting, `wwmd_evaluate`, `wwmd_record_outcome`, durable logging, golden path tests, and operator docs.
- `DecisionInteraction` stores question, options, evidence, sources, rationale, risk tier, confidence, outcome, conflict state, and optional human outcome.
- `PerspectiveMaterial` stores profile material with review, promotion, evidence grade, freshness, confidence, source references, and direction.
- `WikiPage`, `WikiPageLink`, `WikiPageSource`, and `RawSource` already provide page, link, citation, and source primitives.
- `principle_decide` and the shared option-scoring path provide contribution-ledger semantics that should feed the canvas projection.
- Existing visual navigation and PPR specs cover the wiki graph generally; this spec narrows that idea to decision experience and explainability.

## 4. Design Principles

1. **Decide first, explain second.** The decision engine produces recommend/arbitrate/escalate/defer. The experience layer projects that output. It does not create another decision engine.
2. **Bound the graph.** Show the local neighborhood around the decision and surfaced principles. Do not start with a global atlas.
3. **Default to operator-safe language.** Hide raw MCP names, tool ids, and internal skill ids unless an audit drawer is explicitly opened.
4. **Every claim has a governed source.** Principle explanations come from `WikiPage`, `WikiPageLink`, `RawSource`, `PerspectiveMaterial`, and `DecisionInteraction`.
5. **Capture is proposal-only.** Imported research becomes `RawSource` or draft proposals. It does not become an approved principle, stance, or heuristic automatically.
6. **Build Studio is optional for this work.** Because Build Studio is currently unreliable, this plan is written for direct branch work while preserving the same evidence and verification expectations.

## 5. User-Facing Surfaces

### 5.1 Decision Canvas

The Decision Canvas is the primary page-level projection for any Decision Perspective interaction. It answers:

- What question was asked?
- What options were considered?
- What did the selected profile recommend, with what confidence?
- Which principles or profile materials pulled toward or away from the recommendation?
- What evidence and sources were used?
- Was there a commandment conflict, coverage gap, or human override?
- What should happen next?

V1 should render as a structured page or panel, not a freeform draggable canvas. The name "canvas" describes the mental model, not a dependency on a whiteboard library.

Minimum blocks:

| Block | Contents |
| --- | --- |
| Decision header | question, domain class, risk tier, route context, created time |
| Options | option id/label, selected state, short rationale |
| Recommendation | outcome type, recommended option, confidence, next action |
| Principle pulls | positive and negative contributors from the decision ledger |
| Evidence | evidence items, file/spec/build/backlog references |
| Sources | linked `RawSource` and `WikiPage` citations |
| Outcome | human outcome, override state, record-outcome action |
| Audit drawer | raw ids and tool payload excerpts for maintainers only |

### 5.2 Material Backlinks Panel

For every surfaced principle or profile material, show:

- incoming wiki links to the principle/material when it has a wiki page
- outgoing wiki links from the principle/material when it has a wiki page
- stances and heuristics in the same 1-hop neighborhood
- `RawSource` citations
- prior `DecisionInteraction` rows where the principle/material contributed, when available
- open backlog or Build Studio items linked through evidence/source references, when available

The panel should answer "why did this material apply?" without forcing the operator into raw traces.

### 5.3 Review Inbox

The review inbox is the gap-capture surface for profile decisions that return `defer` or `escalate`. For WWMD this is founder review. For WWWD this should be owner/operator review.

Group by operator-readable reason:

- principle gap
- evidence gap
- domain gap
- ownership gap
- conflict review

Each card links to the Decision Canvas and exposes one primary action:

- clarify principle or policy
- request better evidence
- route to domain owner
- record human outcome
- mark duplicate

This should reuse the existing founder-review queue plan where possible for WWMD while keeping the underlying projection generic enough for WWWD owner/operator review. Do not create a second queue model.

### 5.4 Research Capture Adapter

The capture adapter accepts selected external material such as:

- Obsidian-exported Markdown
- web-clipped Markdown
- manually pasted article/spec references

Output is limited to:

- `RawSource` candidate
- draft wiki page proposal when the material belongs in the governed wiki
- draft `PerspectiveMaterial` candidate only when tied to a prior decision outcome or explicit operator capture flow

The adapter must preserve source metadata and review state. It must not publish or promote material.

## 6. Projection Services

V1 should be service-first:

```text
DecisionInteraction / decision response
        |
        v
Decision Canvas projection
        |
        +-- operator-safe view model
        +-- audit detail model
        +-- backlink query inputs
```

New services should live under the existing `apps/web/lib/decision-perspective/` module unless implementation discovers a more specific established local home. Do not introduce a parallel WWMD-only or experience-only substrate namespace.

Suggested modules:

- `decision-canvas.ts` - pure projection from decision rows/results into a view model
- `material-backlinks.ts` - bounded backlinks query/projection for principles and profile materials
- `review-inbox.ts` - generic review projection, with a founder-review adapter only if existing WWMD routes need it
- `research-capture.ts` - candidate normalization and validation only

Do not add schema in the first slice. If implementation finds a repeated derived shape worth persisting, file a follow-up after the pure projection proves useful.

## 7. Access and Safety

- Default route should require the same platform/admin capability used by WWMD and AI authority surfaces.
- Operator view hides raw tool payloads by default.
- Audit drawer may show identifiers such as `interactionId`, `profileId`, `materialId`, and source ids.
- Research capture must reject secret-looking content or mark it review-needed before storage.
- Public rendering is out of scope.

## 8. Non-Goals

- Replacing `principle_decide`, `evaluateDecisionPerspective`, `wwmd_evaluate`, or future WWWD profile evaluation.
- Creating a new `DecisionCanvas` table in V1.
- Creating a separate WWWD decision engine.
- Making Obsidian a supported runtime dependency.
- Importing an entire Obsidian vault as trusted knowledge.
- Building the full wiki atlas from the visual navigation spec.
- Auto-promoting research capture into active principle material.

## 9. Implementation Slices

1. **Projection service.** Build and test the Decision Canvas view model.
2. **Backlinks service.** Build bounded material backlinks from existing wiki/source/decision records.
3. **Decision Canvas UI.** Render the projection from a WWMD interaction.
4. **Founder review integration.** Link defer/escalate outcomes to the canvas and actions.
5. **Research capture adapter.** Add proposal-only source intake.

Slices 1 and 2 can ship without route changes. Slices 3 and 4 make the work visible. Slice 5 is deliberately last because capture has the highest governance risk.

## 10. Verification

Required gates by slice:

- Projection services: unit tests with representative `DecisionInteraction` and `principle_decide` fixtures.
- Backlinks service: unit tests for 1-hop wiki links, source citations, profile material links, and missing-link behavior.
- UI: server/component tests plus browser verification for one decision with positive and negative principle pulls.
- Founder review: test `defer` and `escalate` cards link to Decision Canvas.
- Capture adapter: tests proving captured material stays draft/candidate and never active.

Definition of done for the overall layer:

- A maintainer can open one WWMD or WWWD-style decision and understand recommendation, evidence, material pulls, sources, and next action in under one minute.
- A defer/escalate outcome appears in founder review with a clear action.
- Imported research cannot become active doctrine without human review.
