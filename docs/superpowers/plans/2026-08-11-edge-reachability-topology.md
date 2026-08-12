# Per-install edge reachability & connectivity topology

- **Umbrella BI:** BI-143001FE
- **Epic:** EP-8B03CB06
- **Date:** 2026-08-11
- **Status:** planned — deferred until operator is ready (see Cost budget for right-time provisioning)
- **Source:** holistic connectivity investigation (federation transport, distributor network, mobile, auth surfaces, archetype needs)

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

---

## 1. Problem

Sovereign DPF installs behind **consumer CGNAT** (Starlink, home NAT) have **no inbound public IP** — port-forwarding is impossible. Yet several *already-built* surfaces require the install to be reachable at a **stable public HTTPS URL**, while a few surfaces must stay **private**. No single design ties these together; the pieces are scattered across four epics.

The governing config lever is **`PUBLIC_URL`** (`apps/web/lib/canonical-host.ts`, `apps/web/lib/govern/auth.ts`) — it drives cookie-secure gating, canonical-host redirects, the self-address federation advertises, and the URL mobile/storefront publish.

## 2. Reachability requirements matrix (grounded in code)

| Surface | Needs public HTTPS inbound? | Stable hostname? | Evidence |
|---|---|---|---|
| Federation / distributor network (install<->install) | Yes for cross-org; **No** for same-org | Yes — peer URL stored at enroll | `FederationLink.peerAuthorityUrl`; SSRF guard defaults https+public (`apps/web/lib/federation/client.ts`) |
| Mobile app on cellular | Yes | Yes — install URL persisted | `apps/mobile/src/lib/serverConfig.ts` thin REST client, no offline backend |
| Public storefront / walk-up | Yes | Yes — geo-directory publishes URL | `/api/storefront/*` classified public (`apps/web/proxy.ts`) |
| Customer-facing archetypes (~12/24) | Yes | Yes | `consumptionChannel` axis + field-dispatch derivation |
| Operator portal UI | Reachable, can be private | No | NextAuth supports localhost / LAN / public-behind-proxy |
| **MCP endpoint** (coding agents) | **No — keep private** | No | hardened localhost-only (`apps/web/app/api/mcp/v1/route.ts`) |
| **Internal A2A** | **No — keep private** | No | `apps/web/app/api/a2a/tasks/[taskId]/route.ts` has no auth (gap) |

**Two load-bearing consequences:**
1. **Ephemeral URLs are disqualified** for anything but throwaway testing — federation persists `peerAuthorityUrl`, mobile persists the install URL, the walk-up directory publishes it. A rotating URL breaks links and orphans clients. Stable hostnames required.
2. **Do not blanket-tunnel the whole portal.** `apps/web/proxy.ts` is fail-open for `/api/*` (self-enforcing handlers); `/api/mcp`, `/api/v1/federation`, `/api/inngest` are exempt from canonical-host; every non-cookie credential is a bearer verified by hash lookup with **no transport binding** (TLS is the only replay defence). The public edge must be **path-segmented**.

**Key simplification for the two internal installs:** they are same-organization, and DPF has a same-org private path (`sameOrgLan` allowance + mDNS). **Internal instance<->instance federation needs no public exposure.** Public reachability is only genuinely required for (a) mobile-on-cellular, (b) public storefront/walk-up, (c) cross-org/customer/distributor federation.

## 3. Recommended topology (per-surface, not global)

- **Private mesh (Tailscale) as backbone** — both installs + dev machine on one tailnet. Solves: MCP connector over the tailnet (zero public exposure — the original ask), operator portal access, and internal instance<->instance federation over the same-org path.
- **A stable public edge only for the genuinely-public surfaces** — Cloudflare Tunnel (free, stable custom hostname per instance) with path-based ingress exposing public routes and blocking `/api/mcp` + internal `/api/a2a`, Access in front; or a self-hosted VPS relay if TLS-termination trust matters. `PUBLIC_URL` set to the tunnel hostname per instance.
- **Cross-org / distributor federation** rides the same public edge when real (BI-D43D3D76).

The stack decision itself is captured as a governed decision in the design-doc deliverable (BI-A8CD30F8, routed through `principle_decide`).

## 4. Phases

Each phase is an independently shippable BI. Order is by dependency, not calendar; provision infra just-in-time (Cost budget §6).

- **Phase 0 — Design + decision (BI-A8CD30F8, doc, small).** Write the spec under `docs/superpowers/specs/`: requirements matrix, per-surface stack decision via `principle_decide`, cost budget. *Verification:* doc indexed by `search_specs_and_plans`; decision ledger captured.
- **Phase 1 — Private-mesh baseline (reuses BI-18A42A6D).** Tailscale on both installs + dev machine; MCP + operator + internal federation over the mesh. *Verification:* MCP reachable from CLI over tailnet with no public exposure; two installs federate over same-org path.
- **Phase 2 — Harden the private boundary (BI-07BD42FC bug + BI-2FAF481C feature).** Close the A2A task-read no-auth gap (`dpf-tdd`: failing test first); classify and enforce public vs private routes; verify MCP + internal A2A unreachable via a test public edge. *Verification:* unauthenticated A2A read is 401/403; MCP/A2A blocked at the edge.
- **Phase 3 — PUBLIC_URL correctness (reuses BI-A5842B04 + BI-9D2E4F17).** Fix canonical-host 301 of internal callbacks and enroll self-address resolution — prerequisites for any public `PUBLIC_URL`. *Verification:* internal `/api/inngest` + `/api/mcp` callbacks survive a public `PUBLIC_URL`; enroll resolves a reachable URL.
- **Phase 4 — Public edge + operator UX (BI-55F12490 feature + BI-F6A39E36 runbook).** Operator edge-setup surface + reachability preflight; mobile-on-cellular runbook. *Verification:* operator sets edge + runs preflight from portal; a phone on cellular loads a real install.
- **Phase 5 — Cross-org / distributor reachability (reuses BI-D43D3D76).** Optional least-authority relay for routed/CGNAT peers, only after direct operation is proven. *Verification:* per BI-D43D3D76 acceptance (relay cannot expand scope; direct-link still works).

## 5. Backlog coverage

- Parent: BI-143001FE
- Decision: decomposed
- Receipt: cmsphseba0kp901qrb8dv3v7d (record_plan_backlog_coverage, decision=decomposed, 9 live BI mappings)
- Plan: docs/superpowers/plans/2026-08-11-edge-reachability-topology.md

Deliverable -> BI map (ASCII arrows; every independent deliverable maps to a live BI, new or reused):

- design-doc-and-decision -> BI-A8CD30F8 (new)
- a2a-task-read-auth-fix -> BI-07BD42FC (new)
- public-edge-route-segmentation -> BI-2FAF481C (new)
- operator-edge-setup-and-preflight -> BI-55F12490 (new)
- mobile-cellular-runbook -> BI-F6A39E36 (new)
- cross-org-relay-reachability -> BI-D43D3D76 (reused)
- same-org-lan-url-autoderive -> BI-18A42A6D (reused)
- public-url-canonical-host-fix -> BI-A5842B04 (reused)
- public-url-enroll-selfaddress-fix -> BI-9D2E4F17 (reused)

Dependencies:
- public-edge-route-segmentation -> depends-on -> BI-A5842B04
- operator-edge-setup-and-preflight -> depends-on -> BI-9D2E4F17, BI-18A42A6D
- mobile-cellular-runbook -> depends-on -> BI-A8CD30F8

## 6. Cost budget

### 6a. Infrastructure (monthly $, right-time provisioning)

| Stack | Cost | Covers | Provision when |
|---|---|---|---|
| **Tailscale** (private mesh) | $0 Personal (3 users / 100 devices); ~$6/user/mo if you outgrow it | MCP, operator, internal federation | Phase 1 — now-ish |
| **Cloudflare Tunnel + Access** | $0 (free tier); domain ~$10/yr; Access free <=50 users | Public edge for mobile/storefront/cross-org | Phase 4 — when mobile-on-cellular or a live storefront is needed |
| **Tailscale Funnel** | included in Tailscale plan | Public edge if already on Tailscale | alt to Cloudflare, Phase 4 |
| **Self-hosted VPS relay** (Hetzner/DO) | ~$5-6/mo per box + domain | Public edge you fully own (no third-party TLS termination) | Phase 4/5 if token-trust matters |
| **ngrok** | $0 ephemeral / ~$8-20/mo reserved | throwaway testing only (disqualified for prod — ephemeral URLs) | never for prod |

Realistic near-term run-rate: **~$0-1/mo** (Tailscale Personal free + a ~$10/yr domain) until you turn on the public edge, then **~$0-6/mo** for Cloudflare Tunnel, or **~$5-12/mo** if you self-host the edge. Multiply the public-edge line per additional exposed instance only if you want separate hostnames (one Cloudflare Tunnel daemon fronts both).

### 6b. Engineering effort (from BI sizes)

| Phase / BI | Size | Rough effort |
|---|---|---|
| BI-A8CD30F8 design+decision | small | < 1 day |
| BI-07BD42FC A2A auth fix | small | < 1 day |
| BI-2FAF481C route segmentation | medium | 1-3 days |
| BI-55F12490 operator setup + preflight | medium | 1-3 days |
| BI-F6A39E36 mobile runbook | small | < 1 day |
| Reused: BI-A5842B04, BI-9D2E4F17 (PUBLIC_URL) | small each | < 1 day each |
| Reused: BI-18A42A6D (LAN URL), BI-D43D3D76 (relay) | (relay is large) | relay 1-2 wks when needed |

New work total (excludes the deferred relay): **~1 to 1.5 weeks** of engineering, sequenceable in the phase order. Phase 1 (mesh) is mostly ops, not code.

## 7. Risks & rollback

- **Exposing a localhost-trust surface** (MCP / internal A2A) via a mis-scoped tunnel — the highest risk. Mitigation: Phase 2 hardening + Phase 4 path-segmented ingress land before any broad public exposure; start with Access/allowlist in front.
- **PUBLIC_URL breaks internal callbacks** (`BI-A5842B04`) — canonical-host 301s `/api/inngest` + `/api/mcp`, killing background jobs fleet-wide. Mitigation: Phase 3 precedes Phase 4; never set a public `PUBLIC_URL` before that fix.
- **Third-party TLS termination** — Cloudflare/ngrok/Funnel see traffic at the edge, and bearer tokens have no transport binding. Mitigation: self-hosted relay option (§3) when trust matters.
- **Rollback:** every phase is independently revertable; the private mesh (Phase 1) has no public blast radius, and the public edge is a separate daemon/config that can be torn down without touching the portal.
