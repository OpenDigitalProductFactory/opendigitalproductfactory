---
status: draft
---

# Estate Discovery first-install design

**Backlog:** BI-2EFF90F2, BI-EFC3C31D  
**Workroom:** WC-D663D639  
**Decision:** DI-3A6F2B716C19 (`reuse-external-access`, high confidence, autonomy eligible)

## Problem

Estate Discovery has three contradictory first-install behaviours:

1. The external MCP `discovery_sweep` is declared as an outward business action. That invokes the WWWD alignment gate, whose market, segment, product, motion, geography, and customer-type criteria do not describe an observational network refresh and cannot be supplied by setup.
2. Scheduled, browser, and HTTP API paths still persist discovery runs. The attended external-agent path is therefore the only path refused even though it delegates to the same bootstrap discovery action. The earlier live finding that Save & Test persisted a run describes an older runtime: current `main` tests a connection without persisting and uses the explicit connection rerun for durable ingestion.
3. Local DPF runtime observations are presented beside connected estate observations without a plain provenance statement, while Docker bridge gateways can generate `gateway_connection_needed` work that no physical gateway connection can resolve.

The browser's **Run Sweep** button is not subject to the MCP veto; it calls `triggerBootstrapDiscovery()` directly. The defect is the MCP consequence classification, not a shared action-level refusal.

## Goals

- Let an authorized external agent invoke `discovery_sweep` without unrelated business-alignment criteria.
- Keep network reach, capability authority, MCP annotations, and persisted tool execution legible.
- Keep browser, API, scheduled, and MCP callers on one discovery application service without borrowing another surface's authentication context.
- Prevent Docker-origin gateways from creating actionable connection issues.
- Make the first Estate viewport say whether the latest run observed the local DPF runtime or a configured external estate source.
- Add Estate Discovery to guided setup before contributor-only Platform Development and Build Studio steps.
- Preserve the existing connection form, collector implementations, identity resolution, and canonical entity model.

## Non-goals

- Do not weaken alignment for tools that publish, spend, message, or otherwise take an outward business action.
- Do not add a fourth `ToolConsequence` value.
- Do not suppress the local runtime from the evidence graph; it is real platform evidence. Suppress only false operator work created from Docker-internal topology.
- Do not invent sample/demo provenance. Use the canonical `DiscoveryRun` and `DiscoveryConnection` evidence without overloading either one.
- Do not change observation retention in this slice. The backlog item records retention as an open capacity question, not a reproduced defect.

## Design

### 1. Separate network reach from business consequence

`ToolDefinition` already has two independent axes:

- `requiresExternalAccess` controls external-access visibility and projects MCP `openWorldHint`.
- `consequence: "outward"` means the tool's effect leaves the business and therefore requires WWWD alignment.

`discovery_sweep` reads an operator-configured endpoint and persists observations inside DPF. It is not a publish, spend, message, or external state mutation. Change its declaration to:

```ts
requiresExternalAccess: true,
sideEffect: true,
// no consequence
```

Keep `requiredCapability: "manage_provider_connections"` and the `telemetry_read` agent grant. The result is an ordinary, audited mutation with explicit external reach. Scheduled bootstrap, connection test, browser refresh, and external MCP refresh then share the same authorization model: the caller needs the relevant platform permission, but an observational refresh does not pretend to be a business direction decision.

Do not leave the MCP handler calling `triggerBootstrapDiscovery()`. That function is a browser server action and obtains its caller from `auth()`. The MCP runtime has already authenticated its token, capability, and agent grant; borrowing a NextAuth session from the browser boundary is both redundant and unreliable.

Extract a thin application service that owns the call to `executeBootstrapDiscovery()`, safe error translation, and result projection. Then:

- the browser server action authenticates with `requireManageDiscovery()` and calls the service with trigger `manual`;
- the HTTP route authenticates its session and calls the service with trigger `manual_api`;
- the MCP handler relies on the MCP capability/grant checks and calls the service with trigger `manual_mcp`;
- the scheduler calls the same service with trigger `scheduled` and its system-owned dependency set.

The service accepts explicit dependencies for decryption and persistence in tests; it does not know about NextAuth or MCP request objects. This is the deliberate refactoring slice and makes all four entry paths adapters over one use case.

Add contract tests that prove:

- the tool projects `openWorldHint: true`;
- `classifyConsequentialTool()` returns `ordinary-mutation`, `alignmentRequired: false`;
- the MCP handler reaches the application service without a browser session;
- browser/API callers still refuse an unauthorized user before the service runs;
- a real outward tool remains alignment-gated.

The kernel chose this option over a new observational consequence class and a name-keyed exemption because it reuses the existing source of truth with the smallest policy blast radius (DI-3A6F2B716C19).

### 2. Contain Docker-origin gateway work at issue generation

`isDockerOriginEntityKey(entityKey, name)` is already the canonical server-side detector used by inventory quality and gateway candidate projection. `flagUnconfiguredGateways()` currently queries canonical gateway/router entities but does not apply that detector before opening issues.

Filter every candidate through `isDockerOriginEntityKey()` before coverage matching and issue-key creation. This keeps local runtime topology in inventory while making `gateway_connection_needed` unrepresentable for Docker bridge gateways. Because the active issue-key set excludes Docker rows, the existing reconciliation pass also resolves historical Docker-origin gateway issues on the next run.

Add a focused test around a small pure candidate predicate rather than testing the database loop indirectly. The predicate must:

- reject `gateway:docker-gw:*`, Docker-labelled names, and 172.16/12 ARP/name shapes already recognized by the shared helper;
- retain a physical UniFi/router candidate;
- leave endpoint/entity-id coverage logic unchanged.

Keep the predicate beside the issue generator unless a second production caller exists. The canonical reusable rule remains `isDockerOriginEntityKey()`; creating a new shared module for one boolean composition would add a second source of truth.

### 3. Project run provenance, not assumptions

Extend `getLatestDiscoveryRun()` to select `sourceSlug` and `edgeNodeId`. The run's `sourceSlug` is the persistence namespace, not a complete list of collectors inside a mixed bootstrap run. Project a small, closed presentation model server-side from the run plus exact configured-connection keys/count:

| Source evidence | Operator label | Explanation |
|---|---|---|
| `dpf_bootstrap`, zero configured connections | Local DPF runtime | DPF observed its own host, containers, and runtime topology. This is not evidence that the external estate is connected. |
| `dpf_bootstrap`, one or more configured connections | Combined discovery sweep | The sweep always included local runtime collectors and attempted active configured collectors. Connection health, not the run label, says whether each external source succeeded. |
| `sourceSlug` exactly matches a configured `connectionKey` | Connected source refresh | An explicit rerun persisted observations for that configured source. |
| non-null `edgeNodeId` | Edge node refresh | A registered Edge Node submitted the run. |
| unknown/legacy source | Discovery source unconfirmed | The run is retained, but its source cannot be established from current evidence. |

Do not infer “sample data” from zero connections, parse a source out of `observedKey`, or call every non-bootstrap slug a configured source. `DiscoveryRun.sourceSlug`/`edgeNodeId` and exact `DiscoveryConnection.connectionKey` matches are the canonical typed evidence available in this slice.

Update `DiscoveryRunSummary` so the first viewport leads with an outcome rather than the run key:

- heading: **Local runtime observed**, **Combined discovery sweep**, **Connected source refreshed**, **Edge node refreshed**, or **Discovery source unconfirmed**;
- a compact provenance badge using existing design tokens;
- the run key remains secondary audit detail;
- if there are no configured connections and the latest run is local bootstrap, state: **No external estate connection is configured. Local runtime findings do not represent your network.**

Project the provenance on the server and pass only the safe presentation object plus `connections.length` into the summary; do not expose connection keys/endpoints to the client or issue a second client query. The existing `SavedConnectionsPanel` remains immediately below and supplies the Add Connection action.

### 4. Put Estate in guided setup

Add `estate-discovery` to the canonical `SETUP_STEPS` sequence after `storefront` and before `platform-development`, routed to `/platform/tools/discovery`, labelled **Estate**.

This position completes the operator's business and customer-facing setup, then asks what operational environment DPF may observe, before shifting into optional platform contribution and self-development concepts.

The setup overlay prompt for this step must:

- explain the difference between local runtime evidence and connected estate evidence;
- point to **Add Connection** without asking the agent to collect or repeat a secret;
- make skip a valid choice when the operator does not yet have a gateway credential;
- state that adding a connection authorizes observation of that endpoint, not changes to external devices.

No schema migration is required. `PlatformSetupProgress.steps` is JSON and projection already fills missing canonical steps as pending. Tests must prove:

- a new record contains all 12 steps;
- an in-progress older 11-step record advances into the inserted Estate step rather than silently skipping it;
- a row already marked complete is not reopened by the new canonical step;
- skip records an explicit resolution and continues to Platform Development.

## UX acceptance

On a first install with a completed `dpf_bootstrap` run and zero connections, the first viewport must answer three questions without scrolling:

1. **What did DPF observe?** Its local runtime.
2. **Has my estate been connected?** No.
3. **What do I do next?** Add a discovery connection, or skip during setup and return later.

The page must not call local bootstrap observations sample data, must not imply a gateway can resolve Docker bridge issues, and must not hide the real connection action behind an exception queue.

## Architecture and scale

- **Canonical data:** no new table or enum. `DiscoveryRun`, `DiscoveryConnection`, and `isDockerOriginEntityKey()` remain the authoritative sources. The UI model is a derived projection only.
- **Connector boundary:** this PR does not migrate discovery collectors into the unified connector kernel. It follows that kernel's existing third-party-read rule by keeping the network operation outside UI rendering and preserving explicit source/health evidence.
- **Complexity:** the new provenance projection is O(1) after the existing bounded page read. Docker suppression adds O(G) predicate checks to the existing O(G + C) gateway/connection reconciliation and creates no new fan-out.
- **Existing ceiling:** `flagUnconfiguredGateways()` still loads the install's full active gateway/router and connection sets. This slice neither adds that query nor makes it asymptotically worse. Pagination/delta reconciliation and observation retention remain estate-scale work outside the reproduced first-install defects; no scale result is claimed here.
- **Blast radius:** MCP tool classification/annotations, four discovery entry adapters, gateway quality-issue reconciliation, the Estate read model/summary, and setup sequence/projection/tests. Collector protocols, credentials, entity identity, and persistence schema do not change.

## Verification

- Unit: discovery pack definition and consequential policy classification.
- Unit: shared sweep service and browser/API/MCP/scheduler adapter authorization/trigger contracts.
- Unit: Docker gateway candidate predicate and historical issue reconciliation inputs.
- Unit: discovery run provenance projection for bootstrap, connected, unknown, and no-run states.
- Component: run summary copy/semantics for zero-connection bootstrap and connected estate.
- Unit/integration: 12-step setup order, route, label, inserted-step projection, skip, and overlay trigger.
- Functional: on a shared nonproduction install, invoke `discovery_sweep` through MCP and confirm no WWWD alignment interaction is requested; confirm a run persists.
- Functional UX: render `/platform/tools/discovery` with zero connections/local bootstrap, then with a configured collector run; verify first viewport, keyboard order, focus visibility, contrast, and narrow viewport.
- Regression: a representative true outward tool still enters the alignment gate.

## Delivery boundary

One PR owns both backlog items because the policy classification, quality-issue containment, and first-install provenance/setup UX describe one operator outcome: Estate Discovery is reachable and tells the truth about what it has observed. Splitting them would leave at least one contradictory entry path in production.
