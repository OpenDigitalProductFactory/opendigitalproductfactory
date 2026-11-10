# Tool Evaluation: Cloudflare Tunnel (`cloudflared`) v2026.9.3

**Backlog item:** `BI-E2E8BD27`
**Epic:** EP-8B03CB06 — per-install edge reachability and connectivity topology
**Design:** [`2026-09-02-install-public-reachability-design.md`](../../superpowers/specs/2026-09-02-install-public-reachability-design.md)
**Decision:** conditional approval as the first *opt-in* reachability provider. **Not** approved for any install until the four pre-exposure defects below are fixed.
**Risk:** medium (high until the pre-exposure defects are closed)
**Confidence:** 0.78
**Re-evaluate after:** 2027-03-29, or immediately on a `cloudflared` security advisory, a change to Cloudflare's Self-Serve or service-specific terms, or a change of the Zero Trust Free plan

The design names Cloudflare Tunnel as the first provider behind a vendor-neutral
reachability contract and makes this evaluation a prerequisite of implementation.
The question evaluated is narrow: may an operator run `cloudflared` beside the
portal to give a self-hosted install behind CGNAT a public HTTPS name on a domain
they own?

The answer is yes, with conditions. The larger finding is that **the portal is not
yet safe to put on the internet by any provider.** Four defects, found while tracing
what a tunnel would expose, are independent of Cloudflare and would apply equally to
a VPS reverse proxy or Tailscale Funnel. They are listed first because they gate
everything else.

## Pre-exposure defects in DPF (block any public reachability)

Verified against `origin/main` at `6f876d19`.

| # | Defect | Evidence | Why it matters once public |
| --- | --- | --- | --- |
| P1 | **Known default Inngest signing key.** The installer never generates one, so installs run on the value published in the repo. | `docker-compose.yml:306` `INNGEST_SIGNING_KEY: ${INNGEST_SIGNING_KEY:-abcdef0123456789}` (also `:974`); `install-dpf.ps1` does not write the key (only `scripts/scratch-install-rehearsal.ps1:188` does). Inngest runs in production mode (`INNGEST_DEV` defaults to `0`, `:307`), so it verifies signatures — against a public key. `/api/inngest` is exempt from the canonical-host redirect (`apps/web/lib/canonical-host.ts:107`). | Anyone who can reach `/api/inngest` can forge signed function invocations and trigger background jobs. This is already reachable from any device on the LAN today. |
| P2 | **Unauthenticated test route spends the stored Codex OAuth token.** | `apps/web/app/api/test/codex-responses/route.ts`: header comment says "checks for admin session"; the handler `export async function GET()` performs no check. `/api/*` passes the proxy without auth (`apps/web/lib/storefront/storefront-middleware.ts:44`, `apps/web/proxy.ts:89-90`). | An anonymous caller makes the server spend the operator's model subscription. |
| P3 | **Unauthenticated Prometheus metrics.** | `apps/web/app/api/metrics/route.ts:10` `export async function GET() {` with no auth. | Operational detail about the install is public. |
| P4 | **Fail-open host handling without `PUBLIC_URL`, and client-steerable IP keys.** | `apps/web/lib/canonical-host.ts:64-66` passes every host when `PUBLIC_URL` is unset and reads `x-forwarded-host` first (`:157-158`); `apps/web/lib/portal-url.ts:50-52` builds auth redirects from forwarded headers; `docker-compose.yml:189` `AUTH_TRUST_HOST: "true"`. Rate limits key on the **first** `x-forwarded-for` entry (`apps/web/app/connect/pair/route.ts:17`, `apps/web/app/api/v1/federation/membership/sign/route.ts:24`), which the client controls because Cloudflare appends to an existing header. | Auth redirects can be steered by a forged `X-Forwarded-Host`; per-requester limits can be bypassed. The design already names the `PUBLIC_URL` fail-open as its open question 1. |

**Status (2026-09-30):** P1 is fixed by BI-3267763F. Compose no longer carries a
default Inngest key, the installers generate both keys, and a self-upgrade replaces
a missing or public key and recreates `inngest` with the portal.

**Status (2026-10-01):** P2, P3 and the rate-limit half of P4 are fixed in DPF.

- **P2 — fixed.** The unused `/api/test/codex-responses` route is deleted, so
  nothing anonymous can spend the stored Codex token.
- **P3 — fixed for the public path.** `/api/metrics` returns 404 to a request
  that arrived through the `PUBLIC_URL` hostname (`arrivedViaPublicHost` in
  `apps/web/lib/canonical-host.ts`). The internal Prometheus scrape on
  `portal:3000` and LAN callers are unchanged. Condition 4's ingress deny is
  still required; this is the second layer behind it.
- **P4, rate-limit keys — fixed.** Per-client limits and the storefront hold
  record key on the `X-Forwarded-For` entry the nearest proxy appended, through
  one helper (`clientAddressKey` in `apps/web/lib/security/client-address.ts`),
  so a caller can no longer rotate the client-supplied leftmost entry to dodge
  a limit.
- **P4, `PUBLIC_URL` fail-open — governed by the reachability overlay.** It is
  the design's open question 1, and condition 7 already makes `PUBLIC_URL` and
  `AUTH_URL` mandatory, with a startup refusal on a malformed value, before
  any install enables a public hostname. No public exposure path exists until
  that overlay ships, so the behaviour is decided there, not changed here.
  Tracked as BI-19D3A187.

P2, P3 and the rate-limit half of P4 are tracked as BI-88FCDA4C.

P1–P3 are fixes in DPF, not tunnel configuration. Denying the paths at the tunnel
ingress is a useful second layer but is not a substitute: the LAN exposure of P1
exists today without any tunnel.

What is **not** a problem, verified: no route grants trust because a request comes
from loopback or a private address, so the class of defect in CVE-2026-28798 (a
localhost-trusting proxy exposed through a Cloudflare Tunnel on ZimaOS) does not
reproduce here. MCP at `/api/mcp/v1` always requires a bearer or session
(`apps/web/lib/mcp/transport-auth.ts:121-127`); a loopback `Host` relaxes only the
HTTPS-transport check (`:72-79`), and cloudflared forwards `x-forwarded-proto: https`.
OAuth dynamic client registration stays off for a non-loopback resource origin
unless `DPF_OAUTH_DCR` forces it (`apps/web/lib/auth/oauth-policy.ts:40-45`).

## Verified facts about the tool

**Project.** `github.com/cloudflare/cloudflared`, Apache-2.0. Latest release
2026.9.3, published 2026-09-24. 25 releases in the twelve months to 2026-09-29
(26 counting 2026.1.0, which is in `RELEASE_NOTES` but not on the releases page).
Commits on 2026-09-22, 23, 24, 28 and 29.

**Recent security work.** 2026.9.2 shipped an authentication-hardening batch
("TUN-10805: Strip authentication data before forwarding requests", "TUN-10804:
Enforce authentication before origin access"). An unreleased commit on 2026-09-29,
"VULN-141859: Normalize request path when using access rules", is a security fix
not yet in any release. Published advisories are two, both Windows-installer local
privilege escalations (CVE-2023-1314, fixed 2023.3.1; CVE-2020-24356, fixed
2020.8.1); neither affects a Linux container.

**Integrity.** Release notes carry a SHA-256 per asset; apt/rpm packages are GPG
signed; Windows builds are code-signed since 2025-11. No Sigstore/cosign signing of
the container image. The official image `cloudflare/cloudflared` is multi-arch
(amd64, arm64), built on a digest-pinned distroless nonroot base, runs as
`65532:65532`, and its entrypoint is `cloudflared --no-autoupdate`. Tag `2026.9.3`
resolves to manifest list
`sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c`
(Docker Hub API, 2026-09-29).

**Auth model.** A *remotely-managed* tunnel runs from a single token: "Anyone with
access to the token will be able to run the tunnel." Ingress for such a tunnel is
stored at Cloudflare, not on the install. A *locally-managed* tunnel uses a
per-tunnel credentials file (runs that tunnel only, does not expire) plus an
account-wide `cert.pem` needed only to create or delete tunnels. Token rotation is
supported; existing connectors stay up until connections are deleted.

**Network.** Outbound only: TCP and UDP 7844 to `region1/region2.v2.argotunnel.com`
(QUIC, falling back to HTTP/2). No inbound port. The metrics server binds
`127.0.0.1:20241-20245` on a host but **`0.0.0.0` inside a container** unless
`--metrics` is set.

**Cost and plan scope.** Tunnel is "Available on all plans". The Zero Trust Free
plan is "$0 forever" for up to 50 users, includes Access, and keeps logs "Up to 24
hours"; pay-as-you-go is $7 per user per month. A public hostname on a Free or Pro
zone requires the domain's **nameservers on Cloudflare** — partial (CNAME) setup is
Business or Enterprise only. The operator's real costs are a domain (registrar
price) and moving its DNS to Cloudflare. Account limits: 1,000 tunnels, 25 replicas
per tunnel, 50 service tokens.

**Terms.** The Self-Serve Subscription Agreement was last updated 2025-09-12; Free
services may be terminated "in our sole discretion". The old §2.8 content
restriction now lives in the Application Services service-specific terms (updated
2026-09-28): on Free/Pro/Business, Cloudflare may limit accounts that serve "video
or a disproportionate percentage of pictures, audio files, or other large files"
through the CDN without a paid media product. The Tunnels FAQ confirms this applies
to public hostnames. Zero Trust may not be resold.

**Data handling.** TLS terminates at Cloudflare's edge: "Cloudflare must decrypt
traffic in order to cache and filter malicious traffic." Everything served through
the tunnel — portal pages, WWWD content, documents, MCP bearer tokens in request
headers — is visible to Cloudflare in plaintext. A customer DPA (v6.4, 2026-04-03)
with EU SCCs covers self-serve accounts. The Data Localization Suite is an
Enterprise-only add-on.

## CoSAI security findings

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 1 | Authentication | medium | A remotely-managed tunnel token is a bearer credential: whoever holds it can run the tunnel and receive the install's traffic. `cert.pem` for locally-managed tunnels is account-wide and valid for ten years. | Pass the token via `TUNNEL_TOKEN_FILE` (mode 0600, file-backed secret), never an environment variable or log line. Never place `cert.pem` on the install. Document rotation (refresh token, delete connections). |
| 2 | Access control | medium | Cloudflare Access can gate paths, but DPF must remain the only policy decision point (design invariant 3). Access "Bypass" is unlogged. Managed OAuth must not front DPF's own OAuth server ("If you run your own OAuth server behind an Access application… do not enable this feature"). | Access policies are optional defence in depth on `/platform` and `/admin`. Do not enable Managed OAuth. For MCP clients, either leave `/api/mcp/v1` to DPF's bearer auth or add a Service Auth policy with `CF-Access-Client-Id`/`Secret` headers — never a Bypass on admin paths. |
| 3 | Input validation | **high until P1–P4 fixed** | cloudflared forwards the full path and headers unmodified, so every input-handling weakness in the portal becomes internet-reachable. Pre-exposure defects P1–P4 are exactly this. | Fix P1–P4 in DPF first. Take `cloudflared` ≥ the first release containing VULN-141859. |
| 4 | Data/control boundary | low | cloudflared moves bytes; it has no LLM surface. Content reaching coworkers from public routes is already treated as untrusted. | Pass. |
| 5 | Data protection | **high for regulated operators**, medium otherwise | TLS terminates at Cloudflare; portal content, WWWD data and bearer tokens are readable at the edge. Data localisation is Enterprise-only. This conflicts with `prefer-self-hosted-infrastructure` ("healthcare, finance, and government operators cannot route sensitive data through third-party APIs"). | Opt-in only, with this stated in the enable flow. The reachability contract must keep a provider that forwards TLS unterminated (for example a VPS doing SNI passthrough, or Tailscale Funnel's TLS passthrough) so a regulated operator is never forced through a decrypting edge. |
| 6 | Integrity controls | low | SHA-256 per asset, GPG-signed packages, multi-arch image with a digest-pinned base. No image signature. | Pin the image by digest (above) and re-evaluate on every bump; never `latest`. |
| 7 | Session/transport | low | Edge-to-connector traffic is TLS (QUIC with post-quantum key agreement by default, HTTP/2 fallback). The connector-to-portal hop is plain HTTP on the Docker network. | Keep the portal hop on an internal network only. Forward `x-forwarded-proto: https` (default) so MCP's HTTPS check holds. |
| 8 | Network isolation | **high if misconfigured** | Integration test: `cloudflared` accepted a config whose catch-all rule routes to `http://dev-portal:3001` (`ingress validate` exit 0). It enforces syntax, not *which* services are routable. Remotely-managed ingress lives at Cloudflare, where the install cannot inspect it. | Use a locally-managed, DPF-generated ingress file with exactly one hostname → `http://portal:3000` and a `http_status:404` catch-all, plus a DPF guard that refuses any other service (design invariant 2). Set `--metrics` to the container's loopback address. Attach the connector only to the portal's network, not to the default compose network. |
| 9 | Trust boundary | medium | Cloudflare becomes a network intermediary that can see and, in principle, modify traffic, and can suspend Free accounts at its discretion. | Portal auth stays authoritative; reachability loss must fail closed to LAN-only (design invariant 5). Record Cloudflare as a rented dependency and a gap to close (see Architecture fit). |
| 10 | Resource management | low | Documented sizing (4 GB, 4 cores) is for 8,000 private-network users, not one web app. Per-IP limits collapse to one address unless keyed on `cf-connecting-ip`. | Set container memory and CPU limits and a restart policy. Fix P4 so rate limits key on the address Cloudflare asserts, not the client-supplied first XFF entry. |
| 11 | Operational security | medium | Free-plan logs are kept 24 hours. Reachability state is not yet visible in the product (design acceptance 6). | Surface enabled/connected state in the product. Log tunnel connect/disconnect in DPF. Do not rely on Cloudflare logs for audit. |
| 12 | Supply chain | low | Active project, fast release cadence, two historical advisories (Windows only), Apache-2.0, single vendor-controlled binary. Auto-update is off in the image. | Pin the digest; review each release's notes for `VULN-`/`TUN-` security items before bumping; Dependabot's docker ecosystem can propose bumps. |

## Compliance

- **Licence:** Apache-2.0 for `cloudflared`. Compatible with distribution as an
  optional overlay. The service itself is governed by Cloudflare's Self-Serve
  Subscription Agreement and service-specific terms, not by the licence.
- **Terms that bind operators:** Free services can be terminated at Cloudflare's
  discretion; large-media serving through the CDN may be limited on
  Free/Pro/Business; Zero Trust may not be resold. **DPF must not offer
  Cloudflare Zero Trust to customers as part of a DPF-operated service** under
  these self-serve terms — that path is the separate managed-cell design.
- **Data residency:** traffic is decrypted at Cloudflare's edge in whichever
  region serves the visitor; localisation is Enterprise-only. Acceptable only as
  an explicit operator choice.
- **Regulatory:** not an AI system. Introduces a new processor of personal data
  for any install that serves personal data through it; the Cloudflare customer
  DPA (SCCs) covers self-serve accounts.

## Architecture fit

The contract-plus-provider shape in the design fits: an optional compose overlay,
one connector service, three existing settings (`PUBLIC_URL`,
`PUBLIC_URL_ALIASES`, `MCP_ALLOWED_ORIGIN_HOSTS`), and nothing added to the portal.
Remove the overlay and the install is LAN-only again.

It sits in tension with the commandment
[`absorb-dont-adopt`](../../founder-kernel/wiki/principles/absorb-dont-adopt.md):
it adds an image and a rented service and retires nothing. The mitigating facts
are that a public address from behind CGNAT is inherently external — some node
outside the home must exist, so the capability cannot be absorbed into the
install — and that `prefer-self-hosted-infrastructure` exempts capabilities that
are "inherently external" and cases where "the operator explicitly opts in".
Neither makes Cloudflare the default. **This evaluation therefore approves
Cloudflare only as an opt-in provider, and records the self-hostable,
non-decrypting provider (VPS with SNI passthrough) as the gap to close.** The
trade-off between the two providers is a WWMD decision.

**Scored 2026-10-01, for operator access only** (DI-D96FB0FE7C1F): reaching the
operator's own prod and dev instances from outside the LAN goes over a private
WireGuard overlay, with nothing publicly routable. Scores: overlay 7.67; overlay
now plus opt-in Cloudflare later for public prod surfaces 7.04; VPS with SNI
passthrough 3.53; Cloudflare Tunnel for both instances 2.64. Confidence high,
margin 0.63. Setup is BI-CAF86466. That score does not choose the provider for a
public hostname (federation, storefront, customer mobile); condition 9 still
applies there before implementation starts.

## Integration evidence

Run 2026-09-29 in a disposable Linux container with no Cloudflare account, so the
edge connection itself was **not** exercised.

- Downloaded `cloudflared-linux-amd64` 2026.9.3. SHA-256
  `77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2` matches the
  release notes. `cloudflared --version`: `2026.9.3 (built 2026-09-24-16:07 UTC)`.
- Ingress with one hostname → `http://portal:3000` and a `http_status:404`
  catch-all: `ingress validate` OK. `ingress rule` matched `/api/mcp/v1` and
  `/admin` on the named host to the portal; `evil.example.com` and the lookalike
  `prod.example.com.evil.net` fell to the 404 rule.
- Ingress without a catch-all: rejected, exit 1 ("The last ingress rule must match
  all URLs").
- Ingress whose catch-all routes to `http://dev-portal:3001`: **accepted, exit 0.**
  This is the basis of condition 4.
- `tunnel --help` confirms `--no-autoupdate` and `--metrics`.
- Removal: deleting the binary and config leaves no residue.

Not verified here and required before acceptance: a live named tunnel from the
dev server, the probe in design acceptance criterion 3 (no port other than the
portal reachable), and an MCP client connecting over the public URL (criterion 5).

## Conditions

1. **Fix P1–P4 in DPF before any install enables a public hostname**, by any
   provider. P1 (generate a random `INNGEST_SIGNING_KEY` at install and rotate
   existing installs) is a LAN-exposure defect today and should not wait for this
   epic.
2. Opt-in only. The enable flow states that Cloudflare decrypts all traffic and
   that the domain's DNS moves to Cloudflare.
3. Pin `cloudflare/cloudflared` by digest, at or above the first release that
   contains VULN-141859. Keep `--no-autoupdate`.
4. Locally-managed tunnel with a DPF-generated ingress file; a DPF guard refuses
   any ingress other than one hostname → `http://portal:3000` plus
   `http_status:404`. Deny `/api/inngest*`, `/api/metrics` and `/api/test/*` at
   the ingress as a second layer.
5. Tunnel credentials in a mode-0600 file (`TUNNEL_TOKEN_FILE` or the per-tunnel
   credentials file); `cert.pem` never on the install.
6. `--metrics` bound to the container's loopback; connector attached only to the
   portal's network.
7. `PUBLIC_URL` and `AUTH_URL` required when the overlay is enabled, with the
   design's startup refusal on a malformed value.
8. Do not enable Access Managed OAuth. Any Access policy on MCP uses Service Auth,
   never Bypass.
9. Keep a non-decrypting, self-hostable provider expressible through the contract,
   and score Cloudflare against it with `principle_decide` before implementation.

## Sources

- [cloudflared repository](https://github.com/cloudflare/cloudflared), [LICENSE](https://raw.githubusercontent.com/cloudflare/cloudflared/master/LICENSE), [release 2026.9.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3), [security advisories](https://github.com/cloudflare/cloudflared/security/advisories), [Dockerfile](https://raw.githubusercontent.com/cloudflare/cloudflared/master/Dockerfile)
- [Docker Hub `cloudflare/cloudflared` tags](https://hub.docker.com/r/cloudflare/cloudflared/tags)
- [Tunnel overview](https://developers.cloudflare.com/tunnel/), [run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/), [update cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/update-cloudflared/)
- [Remote tunnel permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/), [local tunnel permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/), [configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
- [Tunnel with firewall](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/), [metrics](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/), [system requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/system-requirements/), [account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)
- [Tunnels FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/), [partial DNS setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/), [plans](https://www.cloudflare.com/plans/)
- [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/), [securing MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [SSL FAQ (edge decryption)](https://developers.cloudflare.com/ssl/troubleshooting/faq/), [customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Data Localization Suite](https://developers.cloudflare.com/data-localization/)
- [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/), [Application Services terms](https://www.cloudflare.com/service-specific-terms-application-services/), [Zero Trust terms](https://www.cloudflare.com/service-specific-terms-zero-trust-services/), [2023 terms update](https://blog.cloudflare.com/updated-tos/)
- [CVE-2023-1314](https://nvd.nist.gov/vuln/detail/CVE-2023-1314), [CVE-2020-24356](https://nvd.nist.gov/vuln/detail/CVE-2020-24356), [CVE-2026-28798](https://nvd.nist.gov/vuln/detail/CVE-2026-28798)
