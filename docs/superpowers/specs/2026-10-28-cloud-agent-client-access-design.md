---
status: draft
---

# Cloud Agent Client Access: one public machine plane for every vendor's cloud agents

**Date:** 2026-10-28

**Status:** Draft; awaiting independent spec approval. The operator ratified `DI-072237D5D7BD` on 2026-10-28.

**Backlog:** `BI-F59EF313` (umbrella, xlarge) under `EP-58240092`; children in §10

**Workroom:** `WC-9A4586CF`

**Decision:** `DI-072237D5D7BD`. The operator ratified the segmented machine plane on 2026-10-28, and the outcome is recorded as followed with a human resolver. The scores were:

| Option | Score |
| --- | --- |
| Segmented machine plane | 10.75 |
| Stay private | 10.36 |
| Vendor relays only | 5.67 |
| Publish the whole portal | 4.12 |

The margin is low at high stakes. The owner's direction (2026-10-28: "design for every vendor's cloud clients at once") excludes staying private. The near-tie is honoured by making public exposure **opt-in per install, off by default**, so private remains every install's default posture.

**Builds on, does not replace:**
- [Install public reachability](2026-09-02-install-public-reachability-design.md): the vendor-neutral overlay, Cloudflare Tunnel first, `PUBLIC_URL` contract (`BI-E2E8BD27`, not built).
- [Company connectivity](2026-10-19-company-connectivity-registry-support-design.md) :56. Operator MCP stays private by default; any external agent API needs an explicitly classified route.
- [MCP client self-authentication](2026-08-26-mcp-client-self-authentication-design.md):
  - §7.3b: no inline CIMD fetching;
  - §12.4: one canonical https origin per install; DCR on the canonical origin; one Connect click;
  - §12.5: the open naming decision.
- [Cloudflare Tunnel evaluation](../../security/tool-evaluations/2026-09-29-cloudflare-tunnel.md): conditional approval. Do not enable Access Managed OAuth; use a 404 catch-all.
- [Cross-install A2A coordination](2026-08-11-a2a-coordination-layer-design.md) §18.2: federation stays on the private overlay. It is unchanged here.
- `BI-8476059F`: the guard that makes a cloud session with no DPF reach say so.

## 1. What the operator asked for

Agents running in vendors' clouds should reach a DPF install the way local clients do: Workrooms, WWMD, backlog and approvals, under the same governed authority. The clients in scope are:
- **Anthropic:** claude.ai connectors and Claude Code on the web; the Messages API and Managed Agents.
- **OpenAI:** ChatGPT connectors, Codex, and the Responses API.
- **xAI:** the API and the Grok app.
- **Google:** Gemini Enterprise.
- **Microsoft:** Copilot Studio.

The thread being retired failed because it could not do this: a cloud session's `https://localhost` is its own container (`BI-8476059F`).

## 2. Where the platform stands (verified 2026-10-28, `origin/main` @ `9bf140dbc26`)

**Built:** an OAuth 2.1 authorization server for MCP. It provides:
- RFC 9728 and RFC 8414 metadata;
- DCR on loopback and the canonical origin;
- S256 PKCE and RFC 8707 audience checks;
- rotating 30-day refresh tokens;
- RFC 7009 revocation, per client and per person;
- a consent binding to an external assistant identity;
- an audited governed tool call.

Code: `apps/web/lib/auth/oauth-*.ts`, `apps/web/lib/mcp/transport-auth.ts`, `apps/web/app/api/oauth/*`.

**Missing:**
1. **No public, WebPKI-trusted address.** The portal binds `127.0.0.1:3000`. Caddy serves an organization-CA certificate and proxies every path (`docker-compose.tls.yml`). No cloudflared or tailscale packaging exists.
2. **The reachability contract never reaches the portal.** `PUBLIC_URL_ALIASES`, `MCP_ALLOWED_ORIGIN_HOSTS` and `DPF_OAUTH_DCR` are never passed to the portal container.
3. **`PUBLIC_URL` fails open** (`BI-19D3A187`).
4. **The MCP route is unclassified.** `apps/web/app/api/mcp/v1/route.ts` is grandfathered in the endpoint-classification baseline, and that budget expires 2026-11-16.
5. **Vendors are not recognized reliably.** Any https redirect registers, and the default assistant is picked partly from the untrusted `client_name` (`oauth-identity-binding.ts:246-253`). Only Claude, Codex and Grok have external identities.
6. **API-style clients have no workable credential.** They need a bearer token in a vault. `client_credentials` tokens last one hour and vaults cannot refresh them. PATs are being retired, and there is no portal surface that issues a `client_credentials` client (`BI-EDB67A2B`).
7. **Public routes have no rate limits.** `/api/oauth/*` and `/api/mcp/v1` are unlimited.
8. **The server misdescribes cloud callers.** It reports "SOURCE-CAPABLE HOST" from its own filesystem (`install/host-profile.ts`). Workroom claims require a server-side `worktreePath` that a cloud checkout never has.

## 3. What every vendor needs (research, accessed 2026-10-27)

| Client | Transport | Auth DPF must offer | Callback / egress |
| --- | --- | --- | --- |
| claude.ai connectors, Claude Code on the web | Streamable HTTP | OAuth: DCR (CIMD only if advertised) | `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/...`; egress `160.79.104.0/21` |
| Messages API connector, Managed Agents | Streamable HTTP | Bearer token; Managed Agents can refresh OAuth | `160.79.104.0/21` |
| ChatGPT connectors and apps | Streamable HTTP | OAuth: CIMD preferred, DCR accepted; `resource` and `aud` checked; no API keys | `https://chatgpt.com/connector/oauth/{id}` and the legacy redirect; best-effort IP list |
| OpenAI Responses MCP tool, Agents SDK | Streamable HTTP | Bearer token, resent on every request | unconfirmed |
| Codex cloud | **unconfirmed** whether custom MCP loads | — | — |
| xAI API remote MCP | Streamable HTTP | Bearer token and custom headers | unpublished |
| Grok app connectors | unconfirmed | OAuth (mechanism unconfirmed) | unconfirmed |
| Gemini Enterprise | Streamable HTTP only | Manual OAuth 2.0 (no DCR or CIMD), or none | `https://vertexaisearch.cloud.google.com/oauth-redirect` |
| Copilot Studio | Streamable HTTP only | OAuth with DCR, or manual; API key | per-connector callback |

All of them require a **public HTTPS endpoint with a publicly trusted certificate**. Every vendor server calls the MCP, discovery, registration and token endpoints. **Only the person's browser** visits the authorization and consent page. No vendor documents server-to-client sampling or elicitation, so DPF plans on tools only.

**An interactive edge login, such as Cloudflare Access, breaks every vendor flow.** The edge must carry transport and WAF only; DPF's authorization server stays the sole policy point. Sources are in the research note on `BI-F59EF313`.

## 4. The public machine plane (`BI-EE4E357D`)

**One switch.** Cloud access is a per-install setting, off by default. Turning it on does three things:
1. It brings up the reachability overlay from the 2026-09-02 design (Cloudflare Tunnel first; Tailscale Funnel as an alternative mode). That gives the install a public name with a WebPKI certificate.
2. It makes that public name the install's **canonical origin**. This follows 2026-08-26 §12.4.1: an explicit operator DNS name ranks first. It is one origin and one token audience, not an alias, and existing clients re-consent once.
3. It publishes only an explicit allowlist on that name:

| Path | Who calls it |
| --- | --- |
| `/api/mcp/v1` | vendor servers |
| `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*` | vendor servers |
| `/api/oauth/register`, `/api/oauth/token`, `/api/oauth/revoke` | vendor servers |
| `/api/oauth/authorize`, the sign-in and consent pages and their assets | the person's browser |

Everything else gets a 404 at the edge. That explicitly includes:
- the portal UI;
- `/api/v1/federation/*` and `/api/a2a/*` (federation stays on the overlay);
- `/api/inngest` and `/api/metrics`.

The routes are classified `public-machine-plane` in the endpoint classification. A test enumerates the app's routes and asserts each one is either allowlisted or 404.

**Local clients keep working.** The canonical name can resolve locally through split-horizon DNS or a hosts entry, and the portal's organization-CA certificate carries the same SAN. Local clients already trust that CA (§12.4.3), so local traffic need not hairpin through the tunnel.

**Why sign-in and consent are public.** People connect from wherever they use the vendor app, including a phone. The alternative was split metadata: the authorization endpoint on a private name, the rest public. Claude documents that pattern for its tunnels; other vendors don't, so it is unconfirmed for them. It would also make connecting impossible away from home.

This choice trades a larger attack surface for a connect that works anywhere. The extra surface is the sign-in page, which §7 rate-limits. **This is open operator decision D2 (§9).**

## 5. Hosted-client OAuth: recognize the vendor by where the code goes (`BI-34ABEC12`)

**No CIMD fetching.** It stays off, as decided in 2026-08-26 §7.3b. AS metadata keeps `client_id_metadata_document_supported: false`, so Claude and ChatGPT fall back to DCR, which DPF already serves on the canonical origin.

**A vendor client catalog.** This is seeded, versioned data, not code. Each entry carries the vendor family, its exact callback URIs and hosts, and its default external assistant identity.

| Vendor callback | Default identity |
| --- | --- |
| claude.ai / claude.com | AGT-EXT-CLAUDE |
| chatgpt.com (both forms) | AGT-EXT-CODEX |
| grok.com / x.ai | AGT-EXT-GROK (callback to verify before seeding) |
| vertexaisearch.cloud.google.com | AGT-EXT-GEMINI (new, seeded like the others) |
| Copilot Studio connector callbacks | AGT-EXT-COPILOT (new) |

**Binding by verified callback host.** At authorization, the vendor is read from the registered redirect host, which is where the authorization code is actually delivered, matched against the catalog. `client_name` is never used. An unrecognized host gets no default identity, and the consent screen says so.

**Gemini Enterprise** supports only manual OAuth. The operator pre-registers its client from the catalog entry, with the callback filled in.

**Consent is unchanged.** It stays one explicit Connect click per person per client (§12.4.8). Prior consent removes the click on reconnect and refresh.

## 6. Cloud API connections for bearer-only clients (`BI-A57C6DB2`)

**Clients covered:** the Messages API connector, the OpenAI Responses MCP tool and the xAI API. They carry a bearer token in a vendor vault and cannot do interactive OAuth.

**What a cloud API connection is.** A confidential OAuth client bound to one external assistant identity and the operator, with explicit scopes. It issues one access token:
- audience is this install's MCP resource;
- lifetime is chosen at creation: default 7 days, maximum 30;
- it is shown once;
- it is revoked in one action.

**Refresh.** For Managed Agents, it also issues a refresh token, so Anthropic's vault keeps the credential current. No personal access token is minted. Issuance reuses the client-credentials client surface that `BI-EDB67A2B` adds.

## 7. Protection before publication (`BI-77367B2C`)

- **Rate limits:**
  - DCR, per source and globally;
  - the token endpoint, per client and per source;
  - MCP, per access token;
  - sign-in, per source and per account.

  Behind the tunnel, the edge-supplied client IP is the key, trusted only on requests that came through the tunnel connector.
- **Vendor family in audit.** Every governed tool call records the vendor family from the catalog.
- **Egress check, detect only.** A call from outside a vendor's published egress ranges is flagged but not refused, because OpenAI's ranges are best-effort.
- **No interactive edge login on these paths.** Edge Access policies may add an IP include rule only for vendors that publish ranges, and only as defense in depth.

This item **must land before** the switch can be turned on in production.

## 8. Cloud sessions are first-class callers (`BI-EE3C3EAF`)

The caller surface is resolved per connection: local plugin, hosted connector (via the vendor catalog), or API connection. MCP instructions and the stance briefing follow it:

| Surface | Told | Can do |
| --- | --- | --- |
| Local plugin client | source-capable host (as today) | everything, under local gates |
| Ephemeral cloud checkout (Claude Code on the web; Codex cloud if it loads MCP) | "ephemeral cloud checkout: cloud CI is the gate" | claim, evidence and PR; pushes use the existing `CLAUDE_CODE_REMOTE` override |
| Hosted connector with no checkout (claude.ai chat, ChatGPT, Gemini, Copilot) | "coordination only" | backlog, Workrooms, WWMD, approvals; source-work claims are refused with the reason |
| API connection | as its bound identity's grants | as scoped |

**Claims without a server-side path.** A claim may carry `checkout: { kind: "ephemeral-cloud", repository, branch, headSha }` instead of `worktreePath`:
- liveness comes from heartbeats;
- the git scanner and the reaper skip these claims;
- the PR is the source evidence.

**Server gates are unchanged.** Platform function never depends on a client: every gate that matters is already enforced on the server.

**When cloud access is off,** `BI-8476059F` still has the session say so at start. It now names the one switch the operator would turn.

## 9. What a person does

| Who | When | Action |
| --- | --- | --- |
| Operator | once per install | Turn on cloud access in Connections. The portal runs the reachability preflight (`BI-55F12490`) and shows the public MCP address. |
| Each person | once per vendor app | Paste the address into that app's "add connector" field. The portal shows the exact steps for each vendor. Then make one Connect click. |
| Operator | once per API agent | Create a cloud API connection and paste its token into the vendor vault. |
| Anyone | any time | Revoke a connection, a person's consent, or turn the switch off. Turning it off removes the public plane at once. |

**Open operator decisions:**
- **D1. Ratify `DI-072237D5D7BD`:** segmented machine plane, opt-in. **Decided 2026-10-28: ratified by the operator.**
- **D2. Where consent happens.** The recommendation is public sign-in and consent, behind the §7 rate limits. The alternative is consent only from home (split metadata), which is unconfirmed for non-Claude vendors.
- **D3. Tunnel provider and account.** The recommendation is the operator's own Cloudflare account. Its credentials are operator-only, never handled by an agent.
- **D4. Archetype defaults.** Installs with `restricted` data, such as healthcare, ship with cloud access off. Turning it on there shows which data classes cloud assistants could reach.

## 10. Delivery order and backlog coverage

| Order | Item | Scope | Depends on |
| --- | --- | --- | --- |
| P0 | `BI-19D3A187`, `BI-E2E8BD27` (existing) | `PUBLIC_URL` fail-closed; the reachability overlay | — |
| P1 | `BI-77367B2C` | Rate limits, edge client IP, vendor audit | — |
| P2 | `BI-EE4E357D` | Public machine plane allowlist, the switch, env plumbing, route classification | P0, P1 |
| P3 | `BI-34ABEC12` | Vendor client catalog, binding by callback host, Gemini and Copilot identities | P2 |
| P4 | `BI-A57C6DB2` | Cloud API connections (composes `BI-EDB67A2B`) | P2 |
| P5 | `BI-EE3C3EAF` | Per-caller surface, ephemeral-cloud claims (extends `BI-8476059F`) | P3 |
| P6 | `BI-55F12490` (existing, deferred; revive) | Operator setup surface and reachability preflight | P2 |

**Related, not absorbed:**
- `BI-143001FE`: the private A2A boundary.
- `BI-2FAF481C`: its "keep MCP off public routes" is superseded by P2's explicitly classified opt-in route. Its A2A and internal half stands.
- `BI-F6A39E36`: mobile reachability uses the same overlay.
- `BI-5ABF833E` / `BI-183095E2`: managed Cloudflare cells.

## 11. Objectives and acceptance

**OBJ-CCA1:** An operator makes an install reachable by cloud agent clients with one switch, and only the machine plane becomes public.

**OBJ-CCA2:** A person connects any supported vendor's cloud app with one Connect click. DPF recognizes the vendor from the verified callback host.

**OBJ-CCA3:** An API-style cloud agent gets a scoped, expiring, revocable credential that is not a personal access token.

**OBJ-CCA4:** Public routes are rate-limited and every cloud call is traceable to a client and vendor.

**OBJ-CCA5:** A cloud session is told the truth about its surface. It can do governed work, including source work from an ephemeral checkout, under the same server gates as a local client.

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-CCA-01 | OBJ-CCA1 | With cloud access off, the public name serves nothing and the MCP endpoint is reachable only locally. |
| AC-CCA-02 | OBJ-CCA1 | With it on, every allowlisted route answers on the public name with a publicly trusted certificate, and every other app route, including `/api/v1/federation/*` and `/api/a2a/*`, returns 404 at the edge. |
| AC-CCA-03 | OBJ-CCA1 | Turning it on makes the public name the canonical origin. Existing local clients re-consent once, and keep working over split-horizon DNS or the tunnel. |
| AC-CCA-04 | OBJ-CCA2 | From claude.ai, a custom connector with the public MCP address connects after one Connect click and lists DPF tools. A Claude Code on the web session uses it to read a Workroom. |
| AC-CCA-05 | OBJ-CCA2 | From ChatGPT developer mode, the same address connects by DCR with `resource` and `aud` checked, and the session binds AGT-EXT-CODEX. |
| AC-CCA-06 | OBJ-CCA2 | A client whose redirect host is not in the catalog gets no default identity, whatever its `client_name`, and consent says it is unrecognized. |
| AC-CCA-07 | OBJ-CCA2 | A Gemini Enterprise custom MCP data store connects through an operator pre-registered client. |
| AC-CCA-08 | OBJ-CCA3 | A cloud API connection token works from the Messages API connector and the xAI API within its scopes, stops at expiry, and stops immediately on revoke. |
| AC-CCA-09 | OBJ-CCA3 | Managed Agents keeps a connection current by refresh without the operator; no `dpfmcp_` token is minted. |
| AC-CCA-10 | OBJ-CCA4 | DCR, token, sign-in and MCP calls over their limits get 429 with `Retry-After`, keyed on the tunnel-supplied client IP only for tunnel traffic. |
| AC-CCA-11 | OBJ-CCA4 | Every governed tool call from a cloud client records its vendor family. A call from outside a vendor's published egress is flagged. |
| AC-CCA-12 | OBJ-CCA5 | A hosted-connector caller's instructions do not claim a source-capable host. A coordination-only caller's source-work claim is refused with a stated reason. |
| AC-CCA-13 | OBJ-CCA5 | A Claude Code on the web session claims a backlog item with an `ephemeral-cloud` checkout, opens a PR, and the claim reads back with repository, branch and SHA. |
| AC-CCA-14 | OBJ-CCA5 | With cloud access off, a cloud session reports at start that it cannot reach DPF and names the switch. |

Acceptance is functional, against the live install with cloud access switched on and real vendor clients. Codex cloud, the Grok app and Copilot Studio are verified as their documented support allows; anything that cannot be exercised is reported unverified.

## Design grounding

**Specs and evaluations read:**
- [2026-09-02 install public reachability](2026-09-02-install-public-reachability-design.md)
- [2026-10-19 company connectivity](2026-10-19-company-connectivity-registry-support-design.md)
- [2026-08-26 MCP client self-authentication](2026-08-26-mcp-client-self-authentication-design.md) §7.3b, §12
- [2026-08-11 A2A coordination](2026-08-11-a2a-coordination-layer-design.md) §18.2
- [2026-08-29 Cloudflare-fronted managed deployment](2026-08-29-cloudflare-fronted-managed-deployment-design.md)
- [Cloudflare Tunnel evaluation](../../security/tool-evaluations/2026-09-29-cloudflare-tunnel.md)

**Code substrate read:**
- `apps/web/lib/mcp/transport-auth.ts`
- `apps/web/lib/auth/{oauth-metadata,oauth-policy,oauth-clients,oauth-identity-binding,oauth-tokens}.ts`
- `apps/web/app/api/oauth/*`
- `apps/web/lib/canonical-host*.ts`
- `apps/web/lib/storefront/storefront-middleware.ts`
- `scripts/endpoint-classification-baseline.txt`
- `apps/web/lib/install/host-profile.ts`
- `apps/web/lib/mcp/agent-host-instructions.ts`
- `apps/web/lib/mcp/packs/work-capsules-pack.ts`
- `apps/web/lib/work-capsules/{git-scanner,liveness-inventory}.ts`
- `apps/web/lib/security/client-address.ts`
- `packages/dpf-skill-pack/{client-capabilities.json,hooks}`
- `docker-compose.yml`, `docker-compose.tls.yml`

**Vendor research:** vendor documentation accessed 2026-10-27 (Anthropic, OpenAI, xAI, Google, Microsoft, Cloudflare, MCP 2025-11-25 authorization). The unconfirmed items are named in §3.
