# Discovery-First Gateway Connections Implementation Plan

- **Backlog item:** BI-E9F5B1E6
- **Related, separately planned work:** BI-51F5229B (federation SAS-first Connections UX)
- **Work capsule:** WC-C3BB5816
- **Branch:** `feat/discovery-first-connections`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

An operator configures a physical-network discovery connection by selecting an identified gateway. DPF carries the gateway identity and canonical endpoint into the credential/test flow. Raw endpoint input is absent from the primary flow and available only through an explicit recovery disclosure with shared client/server normalization and actionable validation.

This plan extends `InventoryEntity`, `DiscoveryConnection`, and `gatewayEntityId`. It adds no parallel device, endpoint, or connection substrate.

## Research and benchmarking

- Ubiquiti documents detailed local UniFi Application APIs and locates API-key management under the local Network application's Integrations surface. Adopt: identify a local UniFi console and ask only for the credential DPF cannot discover. Source: https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API
- Home Assistant's integration guidance treats discovery identity as primary, updates a device's address only when stable identity matches, prevents duplicate configuration entries, and keeps reconfigure/reauth as explicit flows. Adopt: bind the connection to `InventoryEntity.id`, deduplicate by identity/canonical endpoint, and separate normal setup from recovery. Reject: IP address or URL as device identity. Sources: https://developers.home-assistant.io/docs/core/integration/config_flow/ and https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/discovery-update-info/
- Home Assistant instance discovery advertises a friendly name, stable instance identity, host, and port so clients do not ask for an address. Adopt the same presentation hierarchy for existing DPF discovery evidence: friendly name and vendor/model first, address as supporting evidence. Source: https://developers.home-assistant.io/docs/api/instance_discovery/

## Existing substrate

- `apps/web/components/inventory/DiscoveryOperationsPage.tsx` already queries canonical `InventoryEntity` gateway rows but reduces them to the first non-Docker IP; the discovery runner's broader `gateway`/`router` classification must remain aligned here. A tested `DiscoveryConnection` target is also authoritative corroboration when physical ARP evidence still classifies the same address as a generic host; exact endpoint correlation may promote that entity without guessing from address shape.
- `apps/web/components/inventory/AddDiscoveryConnection.tsx` and `ConfigureConnectionInline.tsx` prefill that IP but expose an editable URL in the primary flow.
- `apps/web/lib/actions/discovery.ts` already normalizes some endpoint forms and upserts `DiscoveryConnection`; its URL helper is server-local, incomplete, and does not return field-level validation.
- `InventoryEntity` already carries stable id/entityKey, name, manufacturer, product model, confidence, observed properties, and software evidence.
- `DiscoveryConnection` already carries `gatewayEntityId`, normalized endpoint, collector type, credentials, configuration, and test status.

## Design grounding

- **Existing specs/plans reviewed:** `docs/superpowers/plans/2026-08-07-federation-robust-design-build-plan.md`, `docs/edge-node/unifi-adapter.md`, and the existing discovery-first backlog and UX decision evidence.
- **Current code substrate reviewed:** the canonical `InventoryEntity` and `DiscoveryConnection` models, discovery server actions, discovery operations route, connection setup/edit panels, shared form primitives, and canonical Docker-origin filtering.
- **Source of truth:** `InventoryEntity` supplies observed gateway identity and evidence; `DiscoveryConnection` stores the normalized collector endpoint and selected `gatewayEntityId`.
- **Decision:** extend the existing discovery connection flow with identified-device-first selection and keep normalized manual endpoint entry only as explicit recovery; introduce no parallel route, device store, endpoint store, or connection substrate.

## UX fit review

- **Decision:** fits-with-guardrails
- **Decision ledger:** `DI-7CD79EFC3BA6` recommends `identified-device-first` with high confidence and no commandment conflict
- **Owning area:** Platform
- **Route family:** `/platform/tools/discovery` (canonical) and `/inventory` (legacy alias rendering the same page)
- **Primary persona:** non-technical platform operator connecting the local network estate
- **Navigation layer touched:** contextual action inside the existing Discovery Connections panel; no new route or navigation item
- **Reuse/convergence:** compose shared form primitives (`SelectField`, `TextField`, `CheckboxField`, `SubmitButton`, `FormStatus`) and the existing connection panel; do not create a new setup page or card dialect
- **Source truth:** canonical `InventoryEntity` gateway rows plus `DiscoveryConnection`; the selected entity id, not a URL, is the setup identity
- **Empty/failure behavior:** explain when no gateway is identified, preserve a recovery path, retain entered recovery text, and show field-specific validation/test failures
- **AI boundary:** no prompt send
- **Required guardrails:** vendor/model/name precede raw address; candidate confidence is evidence not automatic trust; one unambiguous candidate may be preselected but never silently saved; raw endpoint input is collapsed recovery detail; no hardcoded colors
- **Evidence before merge:** component/action tests, style scan, route-budget measurement manifest, canonical browser exercise at desktop and mobile widths
- **Captured in:** this section and `docs/ux-fit/2026-08-08-discovery-first-connections.ux-fit.json`

## Backlog coverage

- **Decision:** atomic
- **Receipt:** `cmsl2mixv0dh601o20yh2yef0`
- **Parent BI:** `BI-E9F5B1E6`
- **Deliverable:** `gateway-discovery-first-setup` — sequencing-only inside this BI
- **Rationale:** candidate resolution, shared normalization/validation, and discovery-first form behavior must ship together. A partial release either preserves raw URL entry as the primary contract or creates a client/server validation split.

## Implementation phases

### 1. Shared candidate and endpoint contracts — sequencing-only

Create pure, client-safe modules under `apps/web/lib/discovery-connection/`:

- `endpoint.ts`: normalize and validate UniFi, SNMP, and ARP recovery input; return a canonical value or a field-specific error; reject credentials, control characters, unsupported schemes, non-root controller paths, and unsafe non-host targets.
- `gateway-candidate.ts`: convert selected `InventoryEntity` evidence into a stable UI contract, collapse generic-route and enriched-device records that share one physical endpoint, recommend UniFi only from explicit Ubiquiti/UniFi evidence, otherwise retain generic choices, and rank unambiguous candidates without treating confidence as authentication.

TDD evidence:

- First-failing unit tests cover IP/host/scheme/port normalization, invalid and unsafe forms, CIDR validation, UniFi identification, generic fallback, ambiguity, and deterministic ranking.

### 2. Server source truth and duplicate safety — sequencing-only

Update `DiscoveryOperationsPage.tsx` to query complete physical `gateway` and `router` candidate fields plus exact physical-host matches for canonical UniFi/SNMP connection targets, reuse the canonical Docker-origin filter, and pass the typed candidate list to `SavedConnectionsPanel` / `AddDiscoveryConnection`. Treat only an active exact-address connection as identity evidence; never infer a gateway from `.1`, inventory order, or subnet position.

Update `apps/web/lib/actions/discovery.ts` to use the shared endpoint contract before any persistence or test request. Preserve edit-by-id behavior, bind `gatewayEntityId`, and make equivalent endpoint keys canonical so save/edit does not create duplicates.

TDD evidence:

- Action tests prove server rejection and canonical keys.
- Server-component tests prove identified candidates reach the client contract and the legacy alias shares the same behavior.

### 3. Discovery-first form — sequencing-only

Refactor `AddDiscoveryConnection.tsx` and `ConfigureConnectionInline.tsx`:

- render gateway candidates as named choices with vendor/model, address, evidence/recommendation, and ambiguity state;
- preselect only when exactly one usable best candidate exists;
- carry the selected entity id and canonical endpoint internally;
- keep API-key/site/TLS credential choices visible as needed;
- hide manual endpoint entry in an explicit recovery `<details>` disclosure;
- compose shared form/status/submit primitives and theme tokens;
- preserve recovery input and inline error on failure;
- keep edit/re-test/re-run linked to the saved entity.

TDD evidence:

- Component tests begin red for no primary URL textbox, candidate identity rendering, preselection, deliberate ambiguous selection, recovery disclosure, retained invalid input, and entity-id submission.

### 4. Documentation and measured UX evidence — sequencing-only

Update `docs/edge-node/unifi-adapter.md` so setup describes selecting the discovered gateway and only uses manual endpoint entry as recovery.

Create `docs/ux-fit/2026-08-08-discovery-first-connections.ux-fit.json` from the measured two-option UX decision; its `scope.files` must exactly cover UI-impacting files. Still exercise the real served route at desktop and mobile widths before handoff.

## Completion gate

1. Targeted Vitest suites for the pure contracts, actions, and inventory components pass from this worktree with the runner root confirmed.
2. `pnpm --filter web build` passes with zero errors.
3. Style/theme drift checks show no new hardcoded-color or off-scale debt.
4. The canonical running app is exercised at `/platform/tools/discovery` on desktop and mobile widths for identified, ambiguous, recovery-error, save/test, edit/re-test, and existing-connection states.
5. The measured UX-fit manifest passes its guard.
6. Documentation accurately reflects the primary and recovery paths.
7. Local merged-code CI passes under the governed shared lease before push/PR.

## Risks and rollback

- **Misclassification:** vendor text may be noisy. Only explicit normalized UniFi/Ubiquiti evidence recommends the UniFi collector; all other candidates remain generic/operator-reviewable.
- **Endpoint breakage:** stricter validation may reject previously stored odd paths. Existing rows remain readable/editable; validation applies on save and gives recovery guidance. Tests pin accepted legacy-equivalent forms.
- **Duplicate rows:** endpoint spelling changes can alter `connectionKey`. Canonicalization is shared and edit-by-id remains the first choice; tests cover equivalent spellings.
- **UI regression:** the current components contain hardcoded colors and hand-rolled controls. Touched controls converge to shared primitives and measured route evidence prevents silent budget/accessibility drift.
- **Rollback:** revert the PR. No schema migration or destructive data rewrite is introduced; existing `DiscoveryConnection` rows remain intact.

## Federation sequencing

`BI-51F5229B` remains covered by `docs/superpowers/plans/2026-08-07-federation-robust-design-build-plan.md` and depends on the active SAS transport work (`BI-7432348C`). Its owning component is currently claimed by `WC-455B85BB`; this branch will not co-claim or mix federation changes into the gateway PR. After that dependency lands, implement `BI-51F5229B` on its own branch/PR using its existing plan.
