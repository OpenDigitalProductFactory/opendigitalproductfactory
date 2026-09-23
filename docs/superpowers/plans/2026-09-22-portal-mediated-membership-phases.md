# Portal-Mediated Organization Membership — Phased Implementation Plan

**Design:** [`docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md`](../specs/2026-09-03-portal-mediated-organization-membership-design.md)
**Epic:** EP-ZERO-CONFIG-FEDERATION

> **Status: executed.** This plan is written after delivery, and says so. Every phase below shipped between 2026-09-05 and 2026-09-06 and is named by its merge commit. It exists because the delivered work needs live backlog coverage — each independently shippable phase mapped to a filed item — and the design's own ordered fix sequence was written as prose rather than as a coverage table. Nothing here is a forecast; the verification column records what was actually observed on the live pair.

**Goal:** A member installation joins its organization by choosing a one-time file in the portal it is already signed into. No environment variable, generated secret, compose overlay, installer flag, typed hostname, or approval click.

**Architecture:** The member generates an EC P-256 key and a PKCS#10 CSR in the portal process. The authority relays that CSR to step-ca over TLS pinned to the organization root and returns the signed chain. Material lands under the federation state directory at 0600 with a facts row in PlatformConfig. A federation tick then proves membership to the authority, which creates a link born trusted on both sides.

---

## Phase 1 — Membership material and the authority sign relay

**Backlog item:** BI-4DD1E739 · **Merged:** `76ef1adc` (PR #5056) · **Independently shippable:** yes

The member cannot join at all until these exist together: material with no relay cannot be signed, a relay with no import surface cannot be reached, and an import with no material writer cannot persist.

- [x] `apps/web/lib/federation/membership-material.ts` — keypair and CSR generation, path preference order (portal home, then `/dpf-state/pki` with posix joins), atomic 0600 writes, pinned-root read, facts read/write
- [x] `apps/web/lib/federation/csr.ts` — hand-built DER CSR, SAN classification, certificate-shape detection
- [x] `apps/web/app/api/v1/federation/membership/sign/route.ts` + `lib/federation/membership-relay.ts` — the relay, `@exposure private-mesh`, pinned-root TLS, per-caller and per-token rate limits, audit ring in PlatformConfig, 200/201 accepted
- [x] `lib/federation/organization-join-import.ts` + the Connections import action — `certifiesKey` check, own-address resolution from configured base URL, request host and reached-at hosts
- [x] MCP pack `federation-membership` with `import_organization_join_file`, its grant and tool-surface baseline entry

**Traced refs.** Contracts: `apps/web/app/api/v1/federation/membership/sign/route.ts`, `apps/web/lib/mcp/packs/federation-membership-pack.ts`. Flow: `apps/web/components/platform/federation-links/OrganizationJoinPanel.tsx`. Acceptance: AC-JOIN-PORTAL, AC-SIGN-RELAY. Objectives: OBJ-MEMBERSHIP-ONLY-SWITCH, OBJ-PORTAL-MEDIATED.

**Verification:** relay answered 200 in 70 ms on development after the CA-client repairs; material written to `/dpf-federation/pki` with the facts row; unit suites for material, CSR, relay, route and import.

## Phase 2 — The authority issues the join file

**Backlog items:** BI-105BB8B2, BI-1F69D3F8, BI-AC7BCC58 · **Merged:** `3921174f` (PR #5058) · **Independently shippable:** yes

Phase 1 leaves the file to be produced by hand. This phase makes the authority mint it from its own portal, and removes the typed hostname.

- [x] `lib/federation/organization-join-issue.ts` — provisioner key unlock, enrolment token minting, authority host resolution, 30-minute TTL
- [x] `issue_organization_join_file` MCP tool with consequence classification `authority`
- [x] Connections panel issue mode with a picker over trusted same-organization peers (BI-1F69D3F8); a hostname is typed only for the explicit "another installation" choice
- [x] Membership-proof pairing: `acceptOrganizationEnrolment` and `createTrustedOrganizationLink` mint a link with `confirmationProvenance: organization-trust` and a null approver (BI-105BB8B2)

**Traced refs.** Contracts: `apps/web/app/api/v1/federation/enroll/organization/route.ts`. Flow: `apps/web/components/platform/federation-links/OrganizationJoinPanel.tsx`. Acceptance: AC-TRUSTED-BOTH-SIDES, AC-MCP-PARITY. Objectives: OBJ-PORTAL-MEDIATED, OBJ-BORN-TRUSTED, OBJ-SESSION-FREE-PARITY.

**Verification:** live pair, 2026-09-06 16:16Z. Production issued the file from its Connections page; development imported it in the platform's own browser session; `link_6c0361010d474467` was born trusted on the first tick with nothing typed and nothing approved. Still trusted and syncing on 2026-09-22.

## Phase 3 — Retire the unreachable edge-node path

**Backlog item:** BI-66A2DFB3 · **Merged:** `4e48b40a` (PR #5074) · **Independently shippable:** yes

Both acts are portal-mediated after phase 2, so nothing reaches the edge-node readiness cards, whose six server actions were unreachable on both installations.

- [x] Connections shows exactly "Create join file" and "Join this installation"
- [x] The six edge-node host actions and their session boundary removed; the remote-action dispatch kept, since the edge binary still honours it
- [x] `readJoinPackageFacts` keeps its script-era fallback so an installation that joined by script is unaffected

**Traced refs.** Contracts: `apps/web/lib/actions/organization-join.ts`. Flow: `apps/web/components/platform/federation-links/OrganizationJoinPanel.tsx`. Acceptance: AC-NO-EDGE-PATH. Objectives: OBJ-MEMBERSHIP-ONLY-SWITCH.

**Verification:** Connections page read back as the automation persona on development — two acts, no "Enable secure" copy.

---

## Backlog coverage

- Decision: decomposed
- Parent: `BI-4DD1E739`
- Receipt: `cmudkozq81j0q01s1rlecmvp6`
- Dependencies: phase-1-material-and-relay -> none; phase-2-authority-issues-join-file -> phase-1-material-and-relay; phase-3-retire-edge-node-path -> phase-2-authority-issues-join-file

| Deliverable | Mapping |
| --- | --- |
| Membership material, sign relay, import action, import tool | phase-1-material-and-relay -> `BI-4DD1E739` |
| Join-file issuance, trusted-peer picker, membership-proof pairing | phase-2-authority-issues-join-file -> `BI-AC7BCC58` |
| Edge-node path retired from the Connections page | phase-3-retire-edge-node-path -> `BI-66A2DFB3` |

## Coverage

| Phase | Deliverable | Backlog item | Objectives served | Acceptance verified |
| --- | --- | --- | --- | --- |
| 1 | Membership material, sign relay, import action, import tool | BI-4DD1E739 | OBJ-MEMBERSHIP-ONLY-SWITCH, OBJ-PORTAL-MEDIATED | AC-JOIN-PORTAL, AC-SIGN-RELAY |
| 2 | Join-file issuance, trusted-peer picker, membership-proof pairing | BI-105BB8B2, BI-1F69D3F8, BI-AC7BCC58 | OBJ-PORTAL-MEDIATED, OBJ-BORN-TRUSTED, OBJ-SESSION-FREE-PARITY | AC-TRUSTED-BOTH-SIDES, AC-MCP-PARITY |
| 3 | Edge-node path retired from the Connections page | BI-66A2DFB3 | OBJ-MEMBERSHIP-ONLY-SWITCH | AC-NO-EDGE-PATH |

Every acceptance criterion in the design's manifest is covered above: AC-JOIN-PORTAL and AC-SIGN-RELAY by phase 1, AC-TRUSTED-BOTH-SIDES and AC-MCP-PARITY by phase 2, AC-NO-EDGE-PATH by phase 3.

## Defects found while delivering, each filed and fixed

| Defect | Item | Resolution |
| --- | --- | --- |
| Portal process could not open a socket to step-ca (DNS starved on the libuv pool) | BI-41EB722B | `done` — c-ares lookup, own non-keep-alive agent, `{all:true}` lookup form |
| Self-upgrade took a LAN install off the network | BI-55A30F8B | `done` — promoter exports the pre-existing bind address before any compose command |
| Estate name never seeded from the setup organization | BI-CA54ACC8 | `done` — organization name is the lowest estate-name tier |
| Member reported the fallback URL's socket error, hiding the authority's refusal | BI-39C06F70 | `done` — most informative failure kept, definitive refusal ends the loop |
