# Main-instance Edge lifecycle and fleet visibility implementation plan

**Backlog item:** BI-6CE3D92B  
**Epic:** EP-DELIVERY-FLOW  
**Decision ledger:** DI-675613EFAC5D (`atomic-foundation`, high confidence)  
**Delivery shape:** one atomic BI, one branch, one PR

> **For agentic workers:** execute this plan as one independently reviewable backlog item. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate below before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Make the Edge Node supporting the current DPF installation understandable and trustworthy before extending the same model into the MSP fleet cockpit. The operator should see whether the local host component is installed, supervised, enrolled, trusted, fresh, compatible, and capable of federation discovery; failures should identify the next governed repair action without asking the operator to run commands.

This work supports backlog federation but does not couple backlog synchronization to Edge availability. Federation remains the transport and reconciliation path after pairing; the local Edge Node supplies discovery, readiness evidence, and operational visibility.

## Existing substrate to extend

- `EdgeNode`, `EdgeNodeCapability`, and `BootstrapToken` remain the only durable node, capability, and enrollment records (`packages/db/prisma/schema.prisma`). No new fleet registry is introduced.
- `/platform/edge-nodes` remains the administrative route, composed from `apps/web/app/(shell)/platform/edge-nodes/page.tsx` and `apps/web/components/platform/edge-nodes/EdgeNodesAdminClient.tsx`.
- `install-state.json.edge`, `Resolve-DpfEdgeEnabled`, `Install-DPFNativeEdgeNode`, and `dpf_native_edge_install` remain the install/upgrade authority. The portal does not become a second host-service manager.
- The Go Edge runtime remains the heartbeat and `federation.discovery` capability source.
- The federation Connections page remains the pairing surface; it links to Edge readiness instead of reimplementing Edge diagnosis.
- Existing deployment, fleet, security, and customer/site scope contracts remain binding:
  - `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
  - `docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`
  - `docs/superpowers/specs/2026-06-24-managed-services-delivery-and-cross-org-federation-design.md`
  - `docs/edge-node/fleet-operations.md`

## Internal implementation phases

These phases are sequencing inside one atomic delivery. None is independently releasable: lifecycle convergence without truthful visibility repeats the current mystery, while a readiness UI without converged host behavior is knowingly misleading.

### Phase 1 — Define server-owned current health

Create a pure Edge lifecycle/readiness projection under `apps/web/lib/edge-node/` and begin with failing tests.

The projection must:

- derive `setup-required`, `starting`, `healthy`, `degraded`, `offline`, `quarantined`, and `revoked` from current time, `lastSeenAt`, trust, accepted capability rows, version posture, installation mode, and local-host identity evidence;
- keep trust and health as separate axes;
- define explicit freshness thresholds in one named contract rather than interpreting raw `status` in components;
- make missing or stale capability evidence visible;
- return failed checks and a stable next-action key suitable for both the Edge and Connections pages;
- tolerate legacy rows with incomplete metadata without treating them as healthy.

Verification:

- focused Vitest cases for heartbeat boundaries, stale stored `active`, pending enrollment, trust transitions, capability degradation, legacy rows, and local-host selection;
- typecheck through the web production build.

### Phase 2 — Identify “This DPF installation” without a parallel identity store

Extend the server page query/projection to select the current installation's node using existing host/install identity and Edge metadata. Where legacy data is ambiguous, report `setup-required` or `degraded`; do not guess by display name.

The first viewport must show:

- one local installation card when identity is proven;
- a setup-required card when Edge is enabled/needed but no local node can be proven;
- the readiness checks for service supervision, enrollment, trust, heartbeat freshness, supported version, and `federation.discovery`;
- a plain-language explanation that the local Edge component discovers nearby installations but backlog synchronization continues through Federation after pairing.

Verification:

- page/projection tests for zero, one, stale, and ambiguous local candidates;
- no direct host filesystem reads from the portal container are treated as proof of a host service.

### Phase 3 — Converge the opted-in host-native lifecycle

Preserve the existing consent boundary: Edge remains governed by the recorded `install-state.json.edge.enabled` choice or an explicit platform activation. Do not silently enable network discovery on installations that opted out.

For an enabled installation:

- make fresh install and governed self-upgrade idempotently install or refresh the checksum-bound native Edge artifact on Windows/macOS;
- preserve enrollment state and avoid minting a replacement identity on every upgrade;
- converge Windows Scheduled Task / firewall state and macOS launchd state;
- restart the native service after artifact/config changes and retain the prior known-good artifact for rollback;
- stop or disable an obsolete Docker Desktop Edge container so it cannot masquerade as LAN truth;
- record a machine-readable install outcome that the portal/readiness projection can correlate with heartbeat evidence;
- fail visibly without making the portal unavailable.

This phase absorbs the implementation and physical acceptance of BI-0C326236.

Verification:

- extend `scripts/installer/native-edge-host-contract.test.mjs` and Windows installer tests;
- cover fresh, already-current, missing-service, stale-binary, and failed-start paths;
- verify self-upgrade sensitive-path coverage and rollback behavior;
- apply against physical Windows and macOS hosts through the governed install/self-upgrade path.

### Phase 4 — Turn the registry into an understandable fleet view

Refactor `EdgeNodesAdminClient` using existing shared UI/report primitives:

- local installation readiness first;
- fleet summary based on derived current health, never raw stored `status` counts;
- clear separation of Health and Trust;
- customer → site → node grouping when scope exists, with unscoped nodes explicit;
- last heartbeat expressed as age plus timestamp;
- version, runtime mode, accepted capabilities, failed readiness check, and one next action visible without opening raw metadata;
- pending approval, quarantine, and revoke actions retained with their existing authority gates;
- remote enrollment moved behind an “Add remote node” workflow so raw token issuance is advanced detail rather than the page's primary job.

Verification:

- component tests for multiple customers/sites, mixed health/trust states, stale nodes, empty state, and accessible action labels;
- light/dark theme verification with only `--dpf-*` tokens;
- first viewport answers “is this installation's Edge working?” and “which nodes need attention?”

### Phase 5 — Connect federation diagnosis and update documentation

- Change Connections' `Not set up` state to consume the shared readiness projection/action contract and link directly to the local Edge readiness card.
- Keep the two concepts explicit: Edge discovers nearby DPF installations; Federation owns trust, pairing, and backlog exchange.
- Update `docs/user-guide/platform/edge-nodes.md`, `docs/edge-node/fleet-operations.md`, Windows/macOS install guidance, and the platform-support watchlist if a new host-specific defect is fixed.
- Explain managed-estate Edge Nodes versus sovereign DPF peers and reserve the MSP customer-health cockpit for the later archetype-specific slice.

Verification:

- focused Connections tests for healthy, setup-required, degraded, and offline discovery states;
- live happy-path verification from Edge readiness to Connections and back;
- confirm an established federation link continues synchronizing while local discovery is intentionally stopped.

## Completion gate

1. All affected Vitest and installer contract tests pass from this worktree.
2. `pnpm --filter web build` passes with zero errors.
3. The exact merged-code candidate passes the governed local-integration-CI gate.
4. UI behavior is exercised against the leased shared nonproduction runtime in light and dark themes.
5. Physical Windows and macOS verification proves install, restart, self-upgrade persistence, heartbeat freshness, and nearby discovery.
6. Existing paired backlog synchronization is verified to remain operational independently of discovery availability.
7. Documentation impact is complete and both BI-6CE3D92B and BI-0C326236 receive canonical evidence before status changes.

## UX fit review

- **Decision:** fits-with-guardrails; `DI-0E22008385C8` selected `readiness-first-progressive-disclosure` with high confidence (composite 9.296, margin 4.872, no commandment conflict).
- **Owning area / route family:** Platform; `/platform/edge-nodes` is canonical and `/platform/federation-links` is the contextual next step. No new dashboard or global navigation entry.
- **Primary persona:** founder/platform operator first, with the same fleet vocabulary extending to the MSP operator later. The first viewport answers whether this installation is ready without requiring service, token, or container knowledge.
- **Navigation layer:** contextual action only (`Open Connections`); existing section navigation remains unchanged.
- **Reuse and source truth:** `StatusBadge` plus shared `edgeHealth`/`edgeTrust` intent domains; server projection from `EdgeNode`, `EdgeNodeCapability`, `BootstrapToken`, heartbeat time, and platform version. No second registry or health store.
- **Empty/failure behavior:** setup-required, ambiguous, stale, offline, quarantined, and revoked states name the failed check. Remote enrollment remains available behind disclosure.
- **AI boundary:** no coworker prompt or automated trust decision.
- **Evidence before merge:** focused component/projection tests, production build, style/prose/UX-fit gates, browser verification in the shared nonproduction runtime, and physical macOS/Windows lifecycle evidence.
- **Captured in:** `docs/ux-fit/2026-08-13-edge-fleet-readiness.ux-fit.json`.

## Risks and rollback

- **Consent regression:** automatically enabling collectors could scan a network without approval. Preserve the recorded Edge-enabled gate and make activation explicit.
- **Identity duplication:** reissuing bootstrap material can create a second node for the same host. Reuse enrolled state and fail closed when local identity is ambiguous.
- **False health:** combining trust with liveness recreates the current defect. Keep the axes separate and derive health at read time from freshness and capability evidence.
- **Upgrade disruption:** host service mutation can fail while the portal is healthy. Treat Edge convergence as bounded/nonfatal, retain the previous artifact, and expose the failure.
- **Platform-specific drift:** Windows Task Scheduler and macOS launchd need contract and physical verification; record new watchlist rows for newly discovered host differences.
- **Federation coupling:** discovery failure must not disable an established link. Regression-test synchronization with discovery stopped.

Rollback is a normal PR revert plus governed self-upgrade to the previous canonical image/artifact. Existing Edge rows and enrollment evidence remain retained; no destructive migration or node-row deletion is part of this delivery.

## Backlog coverage

Coverage is recorded as **atomic** because the health projection, host convergence, operator readiness surface, and federation diagnosis form one truth contract and are misleading if released independently. The MCP coverage receipt is added here immediately after it is issued.

- Decision: atomic
- Parent: `BI-6CE3D92B`
- Receipt: `cmss3wvbb00lh01qe7i60i2bx`
- Dependencies: none
- Rationale: The health projection, native-host convergence, readiness UX, and federation diagnosis are misleading unless they ship as one truth contract.
- Internal dependency order: current health contract → host lifecycle convergence → fleet readiness UX → federation diagnosis and physical evidence
- Existing overlapping defect: `BI-0C326236` is closed by this delivery's Windows acceptance evidence; it is not a separate successor.
