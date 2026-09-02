---
status: active
---

# Install Public Reachability — one contract, pluggable providers

**Date:** 2026-09-02 · **Epic:** EP-1FABA22D
**Backlog:** BI-E2E8BD27

## Problem

The portal is fully built to sit behind a public hostname, and there is no supported
way to give it one. Every piece of the last mile exists except the mile.

A consumer install runs on a residential connection, usually behind CGNAT. There is
no routable address to point DNS at, so the shipped TLS and PKI overlays — which
assume a name that already resolves — are unreachable infrastructure. The operator
who owns a domain and wants their install answerable on it has no path that the
product supports.

## Current-state anchors

Verified against `origin/main` @ `8e262733ff`, 2026-09-02. The public-hostname mode
is real and already wired:

- `PUBLIC_URL` is plumbed through compose (`docker-compose.yml:180`) and read at
  runtime by `resolveAppBaseUrl()` (`apps/web/lib/app-url.ts`) for outbound email
  links, webhook payloads, and federation enrollment.
- `enforceCanonicalHost()` (`apps/web/lib/canonical-host.ts`, called first in
  `apps/web/proxy.ts`) 301s a non-matching origin to the canonical URL with
  `Clear-Site-Data: "storage"`. `PUBLIC_URL_ALIASES` keeps LAN access alive
  alongside a public name — the Home Assistant `internal_url` pattern.
- `docker-compose.tls.yml` runs a Caddy sidecar terminating HTTPS on 443 to
  `portal:3000`, plus an mTLS-only Edge action listener on 8443.
- `docker-compose.pki.yml` runs step-ca as an organization CA;
  `docker-compose.organization-trust.yml` pins that root into the portal's Node
  trust store.
- `/.well-known/dpf-instance.json` and `/.well-known/agent-card.json` are public by
  design and exist to be fetched by a remote client.

What none of that does is make the box answerable from the internet. The Caddy
overlay's own header states the assumption: it expects
`scripts/issue-authority-tls-cert.sh --hostname dpf-authority.lan` to have produced
a certificate for a name that already resolves.

**Nothing shipped since.** A grep of `origin/main` for `cloudflared|tailscale|ngrok|
tunnel` across `docker-compose*.yml` and `scripts/` returns no reachability
packaging.

## Prior decision this extends

`docs/superpowers/specs/2026-06-12-archetype-aware-mobile-companion-remote-access-design.md`
§"Remote access modes" already reasoned about this and deliberately stopped short of
shipping. Its decisions are binding here and are **not** reopened:

- "Mobile reaches the Authority Core through a deployment-selected HTTPS URL or
  private mesh/VPN route."
- "The Authority Core remains the only policy decision point; tunnels move packets,
  not authorization."
- Rejected: "Making DPF depend on one relay vendor."
- Open Question 2: "public HTTPS and private VPN/mesh as supported contracts;
  Cloudflare/Tailscale as documented deployment recipes until tool evaluation
  approves a hard integration."

This design answers that open question: it proposes a **contract** that is
vendor-neutral, and a **first provider** behind it, so that "documented recipe"
becomes "shipped overlay" without the platform depending on one relay vendor.

## Boundary with the managed-cell design

`2026-08-29-cloudflare-fronted-managed-deployment-design.md` (`BI-D5228299`,
`EP-MFG-DELIVER-INSTALL`) also puts Cloudflare in front of DPF. It is a different
problem and the two are peers, not rivals:

| | That design | This design |
|---|---|---|
| Who operates the install | DPF, as a managed service | the customer, on their own hardware |
| Origin | cloud VM, managed container, or Kubernetes cell | a box on a residential connection, usually behind CGNAT |
| What Cloudflare supplies | customer hostnames, DNS, TLS, WAF, Access, cell routing | one outbound-only path to a name the operator owns |
| Provisioning | automated stamp per customer cell | an optional overlay the operator enables |

Its §5 keeps "customer-owned cloud" as a continuing peer option, and its origins are
all substrates that already have a routable address. Neither it nor the Single VM
work addresses the self-hosted install that has no address to point DNS at — which
is the only case this design is about.

Where they must agree: the deployment contracts both extend
(`2026-05-09-deployment-contracts.md`), and the principle that hostname metadata is
routing input, not authorization evidence. That design states it as "the adapter
strips untrusted forwarding headers"; this one states it as invariant 3. If a
Cloudflare adapter is built for the managed case, this design's contract should
consume it rather than grow a second one.

## Research and benchmarking

### The comparable product pattern

**Home Assistant Cloud (Nabu Casa)** is the closest analogue: a consumer install on
residential hardware, reachable from anywhere. Its architecture is a cloud relay —
the browser sends an encrypted request to Nabu Casa servers, which proxy it to the
instance at home; no port forwarding and no DDNS. Home Assistant's own community
documents Cloudflare Tunnel and Tailscale as the self-hosted alternatives for
operators who do not want the subscription.

**Adopt:** the shape — outbound-only connection from the install, no inbound firewall
rule, no static IP, TLS terminated at an edge the operator controls.
**Reject:** a DPF-operated relay. It would make us the custodian of every customer's
traffic, which contradicts the deployment premise that each customer owns a
single-tenant Authority Core, and it is a business commitment, not a feature.

### Candidate providers

| | Cloudflare Tunnel | Tailscale Funnel | Reverse proxy on a VPS |
|---|---|---|---|
| Inbound ports required | none — outbound only | none — outbound only | none at the install; VPS needs 443 |
| Static IP required | no | no | VPS has one |
| Serves the operator's own domain | **yes** | **no** — `device.tailnet.ts.net` only | yes |
| Hostnames per connector | many; wildcard `*.example.com` supported (not mid-hostname) | one per node | many |
| Ports/protocols | HTTP/HTTPS and more | **TLS only, ports 443 / 8443 / 10000** | anything |
| TLS certificates | issued and renewed at the edge | auto-provisioned for the tailnet domain | operator-managed |
| Per-hostname authorization | Cloudflare Access policies | tailnet ACLs | operator-built |
| Notable constraints | vendor account; edge terminates TLS | non-configurable bandwidth throttling; DNS propagation up to 10 min | operator runs and patches a host |

**The discriminator is the operator's own domain.** The originating requirement is
instances answerable on a domain the operator already owns. Tailscale Funnel cannot
do that — it serves `*.ts.net` — which rules it out as the *first* provider while
leaving it perfectly valid as a private-mesh option under the same contract. A VPS reverse proxy can do
it, but hands the operator a host to run and patch, which is the opposite of what a
consumer install should require.

**Adopt:** Cloudflare Tunnel as the first provider — outbound-only, operator's own
domain, one connector serving many hostnames, wildcard support, and per-hostname
Access policies that layer in front of `/platform` and `/admin`.
**Reject as first provider, retain as supported modes:** Tailscale Funnel (wrong
namespace for the stated requirement) and VPS reverse proxy (operational burden).
Both must remain expressible through the contract; neither may be assumed by it.

**Standard followed:** this repository's own convention that a third-party runtime
dependency is adopted only after a written evaluation under
`docs/security/tool-evaluations/` — the path taken for step-ca
(`2026-07-20-step-ca.md`) and authentik (`2026-08-23-authentik.md`). A Cloudflare
Tunnel evaluation is a prerequisite of the implementation, not of this design.

## Design

### 1. A reachability contract, not a vendor

An optional compose overlay, `docker-compose.reachability.yml`, carrying a single
connector service and nothing else. The provider is selected by configuration; the
portal is unchanged and unaware of which provider is in use. The contract is the
three settings the portal already reads:

- `PUBLIC_URL` — the canonical external URL. Already consumed.
- `PUBLIC_URL_ALIASES` — keeps LAN access working alongside the public name.
- `MCP_ALLOWED_ORIGIN_HOSTS` — origin allowlist for browser-based MCP clients.

No new portal concept is introduced. That is deliberate: the reachability layer must
be removable without the portal noticing.

### 2. Exactly one service is routable

`portal:3000` and nothing else. This install currently publishes eight services on
`0.0.0.0` — 1455 (Codex OAuth callback, pinned by an upstream shared client), 3001
(dev portal), 3035 (Build Studio sandbox), 5433, 6379, 8288-8289 (Inngest). None may
be routed.

The overlay must make that structurally hard rather than documented: the connector
declares its ingress explicitly and has no wildcard route to the compose network.

### 3. Edge authorization is additive, never a substitute

Access policies in front of `/platform` and `/admin` are defence in depth. The
install remains the only policy decision point, per the 2026-06-12 decision that
tunnels move packets, not authorization. A reachability layer that is trusted to
authorize would be a second, weaker authority.

### 4. Fix the fail-open before exposure

`parseCanonicalHost()` returns passthrough on a malformed `PUBLIC_URL`, so a typo
cannot lock the operator out. That default is defensible on a LAN and wrong on a
public name: a bad value silently accepts every `Host` header. Behind a public
hostname this needs either a startup refusal or a visible warning; the choice is an
open question below, not a decision this document makes silently.

## Safety invariants

1. The portal never learns which provider is in use, and works unchanged with none.
2. No service other than `portal:3000` is reachable through the connector.
3. The install remains the only policy decision point; edge policy is additive.
4. Enabling reachability is an operator act with a visible state, not a hidden
   default — the failure mode documented in BI-006A04FE, where a default-off env var
   silently disabled federation while the UI reported success, is the pattern to
   avoid.
5. Removing the overlay returns the install to LAN-only with no residue.

## Non-goals

- Not a DPF-operated relay service.
- Not MCP OAuth. Claude Code authenticates over a public HTTPS URL with the existing
  `dpfmcp_` PAT today; browser-based connectors need RFC 9728 discovery, which is
  BI-E4DFDCB0 and independent of reachability.
- Not cross-NAT federation pairing, which is BI-26091014 (hub-mediated Path B).
- Not a replacement for the TLS or PKI overlays; this supplies the routable name
  they already assume.

## Acceptance criteria

1. With the overlay enabled and `PUBLIC_URL` set, the portal answers on the
   operator's own hostname over HTTPS from outside the LAN.
2. With `PUBLIC_URL_ALIASES` set, the LAN address continues to work without a
   redirect to the public name.
3. No port other than the portal's is reachable through the connector — verified by
   probe, not by reading configuration.
4. Disabling the overlay returns the install to LAN-only behaviour with no leftover
   state.
5. A Claude Code MCP client connects over the public HTTPS URL using an existing
   `dpfmcp_` token.
6. Reachability state is visible to the operator in the product, not only in `.env`.

## Open questions

1. **Malformed `PUBLIC_URL` behind a public name** — startup refusal, or accept and
   warn? Refusal risks locking out an operator who typo'd; accepting keeps the
   current silent host-wildcard. Recommend: refuse when a connector is enabled,
   accept-and-warn otherwise.
2. **Where does reachability state surface?** `/ops/installation` renders stance
   cards with rationales and is the natural home, but that page is about what agents
   may do; a connection may belong on the Connections surface instead.
3. **Does the first provider ship enabled-but-unconfigured, or absent?** Invariant 4
   argues for a visible disabled state over a silently absent one.

## Related

- BI-1AE9D368 — the deployment specs an operator would follow to do this cite
  `TRUST_PROXY_HEADERS` and `MCP_PUBLIC_URL`, neither of which exists in code. Fix
  before this ships or it misleads the implementer.
- BI-006A04FE — the default-off-env-var failure mode this design's invariant 4 exists
  to avoid.
- BI-E4DFDCB0 — MCP OAuth, independent.
- BI-26091014 — hub-mediated cross-NAT pairing, downstream of reachability.
