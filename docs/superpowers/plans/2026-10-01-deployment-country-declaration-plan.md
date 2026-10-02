---
status: draft
---

# Deployment country declaration — implementation plan

- **Backlog item:** `BI-06EA3167`
- **Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
- **Design:** [2026-10-01-deployment-country-declaration-design.md](../specs/2026-10-01-deployment-country-declaration-design.md)

> **For agentic workers:** one BI, one branch, one PR. Use `dpf-tdd` red-green for each phase, run the fast local gate before push, and use `dpf-pr-with-dco` for handoff.

## Backlog coverage

- Parent: `BI-06EA3167`
- Decision: atomic
- Baseline: the spec-approval baseline minted from the design's objective and acceptance markers on 2026-10-01
- Receipt: blocked-by: record_plan_backlog_coverage binds the immutable blob of this exact file, so the receipt can only be minted after this commit is pushed; it is then held in the live backlog against BI-06EA3167 rather than copied back here, because copying it would change the blob it binds
- Rationale: a contract with no sender carries nothing, a sender with no receiver is withheld by the egress gate, and a receiver with no world-view reader changes nothing an owner can see. No phase gives an owner a usable outcome on its own.
- Dependencies: `BI-4EC1D572` (the world view, merged in PR #5801)

### Traceability

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| deployment-country-declaration (`BI-06EA3167`, phases 1–4) | OBJ-DCD-CONSENT, OBJ-DCD-MINIMAL, OBJ-DCD-COUNT | `packages/db/src/federated-deployment-declaration-contract.ts`, `apps/web/lib/federation/deployment-declaration-exchange.ts`, `apps/web/lib/footprint/market-footprint.server.ts` | An opted-in install declares its country upward and the receiving world view counts it | AC-DCD-CONSENT-1, AC-DCD-CONSENT-2, AC-DCD-MINIMAL-1, AC-DCD-MINIMAL-2, AC-DCD-COUNT-1 |

## Phase 1 — Contract

`packages/db/src/federated-deployment-declaration-contract.ts` follows `federated-operational-posture-contract.ts`. It defines:
- `DeploymentDeclarationV1`;
- `DEPLOYMENT_DECLARATION_FIELDS`, the allow-list;
- the forbidden coordinate and address fields;
- `DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE`;
- `validateDeploymentDeclaration`, which checks ISO 3166-1 alpha-2 codes and rejects denylisted fields.

**Tests:** allow-list, denylist rejection, an unknown country code, and digest stability.

## Phase 2 — Opt-in and egress

- The setting is the `PlatformConfig` key `federation.deploymentCountry.share`, read and written directly as `apps/web/lib/actions/hive-scout/market-sources.ts` does. A missing row means off.
- `apps/web/lib/federation/deployment-declaration-exchange.ts` builds the record from `parseOrgAddress(organization.address).countryCode`.
- It selects trusted, non-revoked links where this install's role is `managed-by` or `channel-downstream`.
- It sends through `apps/web/lib/federation/push.ts`.
- Turning the setting off sends `state: "withdrawn"` on every link that received a `declared` record.
- A server action, gated on `manage_platform`, flips the setting and runs the exchange.

**Tests:**
- off sends nothing;
- on sends one record per eligible link and none on other roles or revoked links;
- off-after-on sends a withdrawal;
- an organization with no country refuses the switch;
- `federation-outbound.test.ts` covers negative egress for the new record.

## Phase 3 — Receipt and world view

- The receive path upserts `FederatedRecordMirror` rows with `recordType: "deployment-declaration"`.
- A `withdrawn` record sets `syncStatus` to `withdrawn`, and a record on a revoked link is refused.
- `loadMarketFootprint` adds live `declared` mirrors on non-revoked links as deployment rows `{siteId: originInstallationId, country}`.

**Tests:** receive, withdraw, revoked link, and the loader counting each origin once.

## Phase 4 — Settings surface, gate and documentation

- One switch on `/platform/federation-links`, with a preview of the country to be shared and the list of receiving links, built from shared UI primitives and localized messages.
- UX-fit record, typecheck, affected tests and the build gate. UX is checked in light and dark themes and at phone width.
- Docs:
  - the federation connections user guide (what is shared, with whom, how to stop);
  - `docs/user-guide/customers/market-footprint.md` (the source note and possible overlap).
