# Federation Enablement & Pairing — Zero-Shell, Auto-Discovery-First (design increment)

| Field | Value |
| --- | --- |
| Status | Draft for founder review |
| Date | 2026-08-06 |
| Amends | `docs/superpowers/specs/2026-07-19-federated-demand-network-design.md` (§5, R-FDN-09) |
| Trigger | Founder two-instance verification — two same-organization installs (a Mac host and a Windows host) on one LAN |

## 1. Why this increment exists

The founder end-to-end verification proved the federation *machinery* works, but it also proved the *enablement and pairing experience is unshippable to the actual DPF customer*. To connect two installs a developer had to: edit `.env` (`DPF_FEDERATION_EXCHANGE_ENABLED`, `PUBLIC_URL`, `PUBLIC_URL_ALIASES`), `docker compose --force-recreate` the portal, hand-type each peer's LAN IP, and force self-upgrades past the release-batch valve. One of those env changes (`PUBLIC_URL`) silently broke the Inngest executor fleet-wide-style (all background jobs dead) until another manual override.

**None of that is possible for the target user** — a plumber, an HVAC/AC tech, a shop owner who does not open terminals. It also directly violates the design's own ratified requirement:

> **R-FDN-09:** require no IP address, GitHub credential, shell command, certificate management, or database expertise from normal operators.
> **§5:** "A non-technical operator can connect the right DPF installations in a few guided actions."

And it regressed from the design's intended entry point — **automatic nearby discovery (§5.1, mDNS/DNS-SD `_dpf-federation._tcp.local.`)** — to **manual URL entry**, which is the opposite of the vision.

This increment resets the enablement + pairing contract to zero-shell, auto-discovery-first, and makes the platform responsible for all configuration.

## 2. Target experience (the "plumber test")

Two DPF installs on the same shop network. Neither operator types anything but a tap:

1. Each install **auto-advertises and auto-browses** on the LAN (mDNS). No IP, no config.
2. In the portal, the operator sees **"We found another DPF on your network — <friendly name>."** (Discovery is a candidate only; it grants no trust.)
3. Operator taps **Connect** → answers one plain question: **"Is this another DPF you own?" [Yes]**.
4. The other install's operator sees **"<name> wants to connect" → [Approve]** (dual approval).
5. Done. Demand syncs. No IP typed, no `.env`, no Docker, no certificate handling, no forced upgrade.

Manual invitation / URL entry survives **only** as an out-of-band recovery path for routed/off-LAN cases — never the primary flow, and never required on a same-LAN same-org pairing.

## 3. What the platform MUST do automatically (no operator action)

Behind that single Connect tap, the platform — not the operator — is responsible for:

1. **Self Authority URL:** auto-derive the install's LAN-reachable URL (private IPv4). The operator never types `PUBLIC_URL` or an IP. (The design already called for this — "derive a LAN-reachable private IPv4 Authority URL when no explicit `DPF_LAN_AUTHORITY_URL` is configured" — it must actually be wired into the enroll path, not left to `resolveAppBaseUrl` returning null.)
2. **Internal-service safety (closes the incident class):** configuring an authority/public URL must **never** subject internal service callbacks to the canonical-host redirect. `/api/inngest` (and every internal service route) is exempt like `/api/health` already is, and/or the internal service host is auto-aliased. Enabling federation must be incapable of killing background jobs.
3. **Feature enablement:** the federation flag is set by the guided action, not by hand-editing an env file.
4. **Transport trust:** secure auto-pairing needs certificate-valid HTTPS, but the operator must not manage certificates. The platform auto-provisions org HTTPS (embedded Step CA / org-PKI) as part of the guided join, or uses a reviewed certificate-free PAKE. No cert files, no CA passwords, no shell.
5. **Pairing authentication (added by architecture review — closes the MITM gap):** the happy-path "Yes, mine → Approve" dual-tap is, on its own, the **"just works"** pairing method, which the pairing literature is explicit gives **zero MITM protection**. The confirm step MUST be a **Short Authentication String (SAS) numeric comparison**: both installs run an ECDH key exchange, then each screen shows the **same 6-digit code** and the operator confirms they match before trust is granted. This is the IETF `draft-ietf-dnssd-pairing` standard (SAS pairing over DNS-SD — DPF's exact same-LAN case) and Bluetooth LE Secure Connections numeric comparison. The 6-digit compare replaces the invite-token/paste-URL dance entirely.
6. **Instance identity (added by architecture review):** the install's federation identity is a **cryptographic device ID** — the fingerprint of its instance keypair — NOT the current random-UUID `installationId` and NOT a typed URL. Extend the existing `EdgeNodeCertificate` substrate for the keypair rather than adding a parallel identity table (`schema-audit-before-features`). Identity travels with the key, which is what makes address changes (and the `localhost` trap) irrelevant.
7. **Discovery capability provisioned everywhere:** every install's Edge Node must carry `federation.discovery` by default (observed gap: the Windows install's edge had only `discovery.network`, so it could not participate in nearby discovery at all).

## 4. Explicit non-goals (removed from the operator path)

The following must **not** appear in any customer-facing enablement or pairing flow (recovery-only, at most, and never on the same-LAN same-org happy path):

- Editing `.env` or any file (`DPF_FEDERATION_EXCHANGE_ENABLED`, `PUBLIC_URL`, `PUBLIC_URL_ALIASES`, …).
- `docker` / `docker compose` commands or container recreation.
- Typing a peer's IP address or URL.
- Certificate / CA management.
- Forcing or sequencing self-upgrades by hand.

## 5. Fleet-protecting platform fix (independent of federation)

The `PUBLIC_URL` canonical-host redirect currently 301s **every internal API consumer whose Host is not the canonical URL** — observed tonight breaking at least:
- `/api/inngest` (internal `portal:3000` callback) → Inngest signature validation fails → **all** Inngest-driven work (self-upgrade, backups, watchdogs, evals, the federation reconciliation job) silently dies;
- `/api/mcp/v1` (`127.0.0.1:3000`) → the `dpf` MCP tool surface disconnects **and** the local-CI/pregate `gate-worktree` reconciliation fails closed (`invalid JSON response … (status 301)`), so the platform can no longer verify its own changes.

An operator-facing `PUBLIC_URL_ALIASES` band-aid is both insufficient (it did not cover every internal host/path) and off-limits (it requires typing config). This is **pre-existing** (canonical-URL middleware, #822) and hits **any** install that sets `PUBLIC_URL` for a public domain — federation or not. It must be fixed at the platform level (exempt internal service routes — `/api/inngest`, `/api/mcp/*`, and the internal-callback family — from the canonical redirect, the way `/api/health` already is) as a **P1 fleet hazard**, separate from and ahead of the federation UX work.

## 6. Dependencies & sequencing

- The zero-shell secure auto-pairing depends on auto-provisioned HTTPS, which depends on the machine-bound signed Edge action channel (`BI-F12A8D0D`, unstarted) → governed org-join host actions (`BI-A8399604`) → the no-shell Connections workflow (`BI-87B0DBD7`). These were always the gating items; this increment makes them the critical path for customer-facing federation.
- Until they land, federation stays **founder-test-only** (the manual path is acceptable for founder verification, never for a customer).

## 7. Verification — the plumber test

- A non-technical operator connects two same-org installs on one LAN using **taps only**: discover → Connect → "Yes, mine" → peer Approves. No shell, no `.env`, no IP, no certificate, no forced upgrade at any step.
- Turning federation on **never** degrades background processing: Inngest executes throughout; `/api/inngest` is never redirected; the "background jobs need attention" alert never fires as a side effect of enablement.
- Every install ships with `federation.discovery` on its Edge Node and appears as a nearby candidate to same-LAN peers.

## 8. Backlog items to file (governed MCP was offline at authoring)

1. **P1 platform:** exempt `/api/inngest` and internal service callbacks from the `PUBLIC_URL` canonical-host redirect (fleet hazard; kills background jobs on any public-domain install).
2. Auto-derive and wire the LAN Authority URL into the federation enroll path (no operator `PUBLIC_URL`).
3. Provision `federation.discovery` on every install's Edge Node by default.
4. Zero-shell guided Connect: discovery candidate → Connect → **SAS 6-digit numeric compare** → dual approve, with platform auto-config of flag/URL/alias/HTTPS (ties into `BI-87B0DBD7`).
5. Retire manual URL/`.env` entry from the customer path; keep as documented recovery only.

_The redesign that supersedes ad-hoc federation patching is tracked as **BI-67315C4A** (EP-DELIVERY-FLOW); the missing standards reference doc as **IP-43ED5 / BI-IMP-38549108**._

## 9. Conflict & versioning model (added by architecture review — critical)

The shipped design carried **no conflict model**: `DemandEnvelope.originVersion` was set to the source record's `updatedAt` epoch in **milliseconds** (`Date.now()`) and written into an `Int` (int4) column. That value (~1.7e12) overflows int4 (max 2,147,483,647), so **every** `federatedRecordMirror.create()` failed with Postgres `P2020` and demand **never once mirrored across a link** — the defect that let a non-functional feature ship. A wall-clock scalar is the single worst choice: no causality, clock-skew-dependent, and unbounded.

**Requirement:** adopt a **version vector** — a per-`installationId` counter map. Comparison is one-sided dominance (every entry of A ≥ B → A is newer; mixed dominance → a real concurrent-edit conflict surfaced explicitly, not silently lost). Store it as typed JSON keyed by installation, never a scalar clock. A CRDT (e.g. Automerge / last-writer-wins register per field) is the stronger alternative where field-level convergence is wanted.

**Escalation:** version-vector vs CRDT is a genuine architectural trade-off (operational simplicity + explicit-conflict UX vs conflict-free convergence at higher storage/complexity) — route it through `dpf-decision-via-kernel` before implementation, don't assert one here.

_Interim: `#4092` widens the column to `BigInt` so the current link mirrors at all — a stopgap, not this model._

## 10. Substrate fit (added by architecture review)

- **Delivery on the canonical queue.** The hand-rolled `FederatedRecordMirror` outbox + retry + reconcile loop re-implements `WorkQueue` / `QueueTelemetryEvent` / `QueueMetricSnapshot` (EP-056D2A5E). Adopt the **ActivityPub inbox model** — deliver each demand envelope as a job to the peer's inbox — riding `WorkQueue` for retry/backoff/telemetry. `FederatedRecordMirror` retains only mirror + version-vector state, not transport machinery (`single-source-of-truth`).
- **Discovery + pairing extend existing scaffolding.** Build on `lib/federation/nearby-candidates` + `nearby-pairing-service` + `nearby-pairing-rate-limit`; the SAS layer is an addition to that flow, not a new module (`verify-substrate-first`).
- **Identity extends `EdgeNodeCertificate`** (see §3.6), not a new identity table.

## 11. Standards & prior art (market research — the step originally skipped)

| Concern | Standard adopted | Source |
| --- | --- | --- |
| Identity | Crypto device ID = cert fingerprint | Syncthing device IDs |
| Discovery | mDNS / DNS-SD LAN broadcast | Syncthing; `_dpf-federation._tcp.local.` |
| Pairing auth | ECDH + 6-digit SAS (numeric comparison) | IETF `draft-ietf-dnssd-pairing`; BLE Secure Connections |
| Scaling topology | Introducer nodes (== customer→reseller→hub) | Syncthing introducer |
| Delivery | Server-to-server inbox (JSON/HTTP) on a queue | W3C ActivityPub |
| Conflict/versioning | Version vector / CRDT | version-vector & CRDT literature |

Sources: docs.syncthing.net/dev/device-ids, docs.syncthing.net/users/introducer, w3.org/TR/activitypub, datatracker.ietf.org/doc/html/draft-ietf-dnssd-pairing-00.
