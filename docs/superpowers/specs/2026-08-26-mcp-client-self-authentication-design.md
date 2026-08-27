# MCP Client Self-Authentication — OAuth 2.1 for the DPF MCP transport

| Field | Value |
|-------|-------|
| **Backlog item** | `BI-E4DFDCB0` |
| **Epic** | `EP-24741BBF` — DPF Directory Service: absorb identity instead of federating to someone else's |
| **Status** | Design — not implemented. Operator decisions open in §9. |
| **Date** | 2026-08-26 |
| **Author** | Claude Opus 5 for Mark Bodman |
| **Scope (read)** | `apps/web/app/api/mcp/v1/route.ts`, `apps/web/lib/auth/mcp-api-token.ts`, `apps/web/lib/auth/mcp-host-writer.ts`, `apps/web/lib/auth/mcp-setup-snippets.ts`, `apps/web/lib/govern/auth.ts`, `apps/web/app/.well-known/`, `scripts/dpf-bootstrap-agent-toolchain.ps1`, `scripts/lib/mcp-client.mjs`, `docs/Reference/mcp/spec/basic/authorization.mdx` (snapshot `2025-11-25`) |
| **Grounds in (do not duplicate)** | Consumer MCP bootstrap — `docs/superpowers/specs/2026-08-25-consumer-mcp-bootstrap-design.md` (not yet on `main`) · [TAK/GAID auth identity refresh](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) · [MCP `2025-11-25` + A2A adoption](2026-08-06-mcp-2025-11-25-and-a2a-feature-adoption-design.md) · [Enterprise auth, directory, federation](2026-04-22-enterprise-auth-directory-federation-design.md) · [Platform MCP tool server](2026-04-11-platform-mcp-tool-server-design.md) · [Contributor client MCP readiness](2026-05-26-contributor-client-mcp-readiness-design.md) · [MCP tool authorization runbook](../../architecture/mcp-tool-authorization-runbook.md) |
| **Blast radius** | HIGH — the MCP transport is the coordination plane (AGENTS.md §12). Additive by construction: the PAT path is preserved unchanged throughout. |

---

## 0. Framing

The operator's request: *"we need better, more automatic authentication that allows us to just work when connecting between MCP client and system. We were supposed to have done this, not sure why it's not seamless."*

Verification changes the shape of the answer in two ways, and both matter before any code is written.

**It is not seamless because it was never built to be.** `apps/web/app/api/mcp/v1/route.ts:10-14` states the choice in the file header: auth is `Bearer dpfmcp_<token>` issued from `/admin/platform-development`, and *"We do NOT implement OAuth 2.1 resource-server discovery (the GitHub-PAT pattern, intentionally)."* That is a recorded decision, not an oversight or a regression. This design proposes to supersede it, and §2 argues why the conditions that justified it no longer hold.

**"We were supposed to have done this" is literally true, and the reason is a known failure class.** [The TAK/GAID auth refresh](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) §5.10 names `BI-MCP-7E53D1` — *"MCP server-metadata endpoint, OAuth 2.1 + RFC 9728 + RFC 8707 + PKCE for external MCP exposure"* — and schedules it to "land last in this batch". [The `2025-11-25` adoption design](2026-08-06-mcp-2025-11-25-and-a2a-feature-adoption-design.md) §1.3 then defers OAuth *to that id*: *"Defer — tracked elsewhere … Do not re-spec here."*

**`BI-MCP-7E53D1` does not exist in the live backlog.** The work was deferred into a document, the document pointed at an id nobody had filed, and the deferral became permanent silently. This is the same failure `EP-24741BBF` was created to close — see that epic's own body: 111 unchecked Markdown tasks, zero backlog coverage, phase 3 never picked up. `scripts/check-plan-backlog-coverage.mjs` now guards the class prospectively. `BI-E4DFDCB0` is the retro-fix for the MCP authorization slice, and this document is its design.

### 0.1 Two halves, and this is the second one

This design deliberately covers only the *general* half. The *local* half is already designed and must not be re-specified here:

| | **Local half** | **General half (this doc)** |
|---|---|---|
| Backlog | `BI-ED1BBC9E` | `BI-E4DFDCB0` |
| Design | `2026-08-25-consumer-mcp-bootstrap-design.md` (+ `DI-29D9F5D72C50`) | this document |
| Question answered | "How does a *this-box* install hand its own agent a credential with no human?" | "How does *any* client on *any* machine authenticate itself?" |
| Credential | `dpfmcp_` PAT in an OS user env var | OAuth access token in the client's own store |
| Boundary | loopback only, by design | any origin the operator exposes |
| Status | drafted, **unmerged** on `fix/bootstrap-external-agent-mcp-access-on-consumer`, no PR | this document |

**Sequencing: the local half lands first.** It is smaller, it is already designed and kernel-decided, and it closes the felt daily pain on a consumer install. This design assumes it has landed and builds beside it, not on top of it. Neither subsumes the other, and the PAT path survives both.

**One amendment to the local half, recorded on `BI-ED1BBC9E` rather than here:** its bootstrap re-probes and re-mints a stale token, but nothing invokes the bootstrap after install, so a token that lapses on day 31 of its 30-day TTL still strands the client. The trigger already exists — `scripts/hooks/mcp-health.{ps1,sh}` is wired as a `SessionStart` hook in `.claude/settings.json` and probes this exact endpoint at every session start, resume, `clear` and `compact`. Extending that probe to re-invoke the bootstrap on an *expired/revoked/absent* verdict is a small addition to that spec's §Idempotency, not a new design.

---

## 1. Current state — verified, with evidence

Every claim below was checked against the running install on 2026-08-26.

### 1.1 The transport

`/api/mcp/v1` is an OAuth 2.1 **resource server** in every respect except the parts that make one discoverable.

- Auth resolution is `sha256(secret)` lookup against `McpApiToken`, or an internal `X-MCP-Session` JWT (`apps/web/lib/auth/mcp-api-token.ts`, `apps/web/lib/mcp/session-token.ts`).
- Authorization is a real, layered model that this design does not touch: coarse `scope` (`read`/`write`/`admin`) × granular `scopes[]` grants intersected with user role capabilities and — for agent-bound tokens — the acting agent's grants and the acting human's `Principal.sensitivityClearance` (`tokenCanUseTool`, `resolveListingAuthorityForToken`, `filterListableTools`).
- A 401 already carries a `WWW-Authenticate` header, and the header comment says why: *"we still return a WWW-Authenticate header on 401 so clients that perform discovery don't fail mysteriously."*

The intent was right. The header is one parameter short of working:

```http
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="DPF MCP", error="invalid_token",
                  error_description="missing Bearer token or X-MCP-Session header"
```

There is no `resource_metadata`. And:

```
/.well-known/oauth-protected-resource              404
/.well-known/oauth-authorization-server            404
/.well-known/oauth-protected-resource/api/mcp/v1   404
```

`apps/web/app/.well-known/` contains only `agent-card/[agentId]`, `agent-card.json` and `dpf-instance.json`. Per the spec (`authorization.mdx:93-101`) a server **MUST** implement one of the two discovery mechanisms and clients **MUST** support both; DPF implements neither. A conformant client — Claude Code, VS Code and Codex all perform this discovery — receives a refusal it is structurally unable to act on. *The failure is not that the client is unauthorized. It is that the client is told nothing it can use.*

### 1.2 The credential's real lifecycle

There is no authorization server. `apps/web/lib/govern/auth.ts:186-260` is NextAuth acting as an OAuth **client** for Google/Apple social login. The only route under `apps/web/app/api/mcp/token` is `refresh` — and [the readiness design](2026-05-26-contributor-client-mcp-readiness-design.md) is explicit that this is *"a client-environment binding endpoint, not a server readiness signal."*

So the end-to-end path a credential takes today is:

1. A human opens Admin > Platform Development > MCP and mints a token. The plaintext is shown once.
2. It is written into a **Windows User environment variable** (`scripts/dpf-bootstrap-agent-toolchain.ps1:169`) or a POSIX shell-startup file.
3. `.mcp.json` references it as `${DPF_MCP_BEARER_TOKEN}` — correctly, the secret is referenced not embedded (`mcp-setup-snippets.ts`, `mcp-host-writer.ts`).
4. Every client process reads it from its own environment at launch.

Each step is individually sound. The composition has four properties the operator experiences as friction:

- **Launch-ordered.** A client already running when the variable changes cannot see the new value. The documented rotation procedure is `SetEnvironmentVariable` **then** `POST /api/mcp/token/refresh` **then** retry — three manual steps, all human-only.
- **Machine-bound.** An OS-user env var does not cross into WSL, a container, a second workstation, a teammate's laptop, or any remote client. There is no mechanism by which it could.
- **Expiring with no renewal.** `McpApiToken.expiresAt` is real (this install's token dies 2026-11-22; the consumer bootstrap shortens new ones to 30 days). There is no refresh grant. Expiry surfaces as a bare 401 and, per §1.1, a 401 is a dead end.
- **Countable.** 16 `McpApiToken` rows on this install: 11 active, 4 expired, 5 revoked — including hand-minted `tmp-workroom-readiness-*` and `codex-bi-f3422349-*` rows. Agents mint tokens by hand because there is no other way in. That sprawl *is* the friction, in the audit log.

### 1.3 The loopback rule, and what actually forces it

`isAllowedMcpEndpoint` (`scripts/lib/mcp-client.mjs`) accepts only `127.0.0.1`, `localhost` and `[::1]`. The runbook's reasoning is exactly right and worth preserving verbatim in intent: *"a `.mcp.json` file is ambient state… anything with the checkout can write it,"* so a config-resolved token bound for another host is a disclosure (`BI-1819D34F`, CodeQL alert 388).

That rule is a correct response to the credential's *shape*, not to remoteness. A long-lived bearer secret sitting in ambient config must never leave the box. **An audience-bound, short-lived, per-client access token obtained through a browser consent the operator saw is a different object**, and the blunt loopback restriction stops being the only available protection. This design does not remove that guard; it removes the reason it has to carry the whole weight (§7.4).

### 1.4 What is already right and stays untouched

Worth stating plainly, because it determines how much of this is new: **the authorization model needs no change at all.** Scope intersection, grant expansion, listing/call parity, the clearance axis, `governedExecuteTool`, the `ToolExecution` audit row, tool tiers and `load_tools` progressive disclosure all sit *behind* credential resolution. This design changes how a caller proves who it is. It changes nothing about what that caller is then allowed to do.

---

## 2. Should the intentional PAT decision be reversed?

The `route.ts:10-14` decision deserves a real answer, not a silent overwrite.

**Why the PAT choice was right when it was made.** DPF's MCP transport was a single-operator, single-box, loopback surface. OAuth's value is in the *unknown-client, unknown-network, unknown-user* case; against `127.0.0.1` with one human who is already a portal admin, a PAT is less machinery for the same result. The GitHub-PAT precedent is a good one and the comment cites it honestly.

**What changed.**

1. **The client population stopped being one operator.** Claude Code, Codex, VS Code, Grok and Antigravity all connect (see `agent-client-capability-parity.md`); the platform ships bootstrap for four CLI surfaces. Every one of them implements RFC 9728 discovery, and every one of them is currently handed a dead-end 401.
2. **The spec moved from SHOULD to MUST.** Under `2025-11-25`, PRM is a server **MUST** (`authorization.mdx:63-64, 80-81`). DPF advertises `2025-11-25` on the wire (`SUPPORTED_PROTOCOL_VERSIONS`) while not meeting its authorization requirements. That is a conformance defect against a revision we claim, which is a different thing from a design preference.
3. **Consumer installs happen.** A consumer install has no source, no operator with a portal habit, and — until `BI-ED1BBC9E` lands — no token at all. The catch-22 in that item ("an external agent cannot obtain a token without a human using the portal UI, and the portal UI is precisely what an agent cannot use") is the PAT model reaching its limit.
4. **The epic changed the frame.** `EP-24741BBF` decided that DPF *is* the directory for an installation. An install that is its own identity provider but cannot issue an OAuth token to its own agent has not finished being one.

**Recommendation: supersede, do not replace.** Adopt OAuth as the default door. Keep the PAT permanently for headless, CI, cron and container callers that cannot open a browser — those are real and the PAT is the right tool for them. The `route.ts:10-14` comment gets rewritten to state the *new* two-door contract rather than deleted, so the next reader inherits the reasoning instead of the conclusion.

---

## 3. Research and benchmarking

**Normative source.** `docs/Reference/mcp/spec/basic/authorization.mdx` (snapshot `2025-11-25`), already in-repo. Requirements that bind this design:

| Requirement | Spec ref | Obligation |
|---|---|---|
| RS implements RFC 9728 Protected Resource Metadata | `:63-64, :80-81` | MUST |
| PRM includes `authorization_servers` with ≥1 entry | `:81-84` | MUST |
| Discovery via `WWW-Authenticate` `resource_metadata` **or** well-known URI | `:93-101` | MUST (one of) |
| `scope` parameter in the 401 challenge | `:104-106` | SHOULD |
| AS implements OAuth 2.1 for confidential **and** public clients | `:54-55` | MUST |
| AS metadata via RFC 8414 **or** OIDC Discovery | `:66-70` | MUST (one of) |
| Client ID Metadata Documents (SEP-991) | `:56-58, :211-239` | SHOULD |
| Dynamic Client Registration (RFC 7591) | `:59-61, :326-331` | MAY — explicitly "for backwards compatibility" |
| RFC 8707 `resource` on authorization **and** token requests | `:400-437` | MUST |
| RS validates token audience is itself; rejects all others | `:469-483` | MUST |
| 403 + `error="insufficient_scope"` + `scope=` for runtime scope failures | `:487-540` | SHOULD |
| Tokens never in the URI query string | `:457` | MUST |

**Two spec details that shape the DPF design specifically:**

- **CIMD needs the public internet.** A Client ID Metadata Document `client_id` **MUST** be an `https` URL with a path, and the AS fetches it (`:227-236`). On a fully-local, air-gapped-by-choice install the AS cannot fetch a vendor-hosted `client.json`. CIMD is therefore correct for a DPF install the operator exposes, and **unusable** for the local-only case. DCR needs no outbound fetch and is the local path. DPF must support both — the priority order in `:204-209` already anticipates a server offering more than one.
- **Step-up authorization is a direct mapping of something DPF already has.** `:495-540` defines a 403 + `WWW-Authenticate: error="insufficient_scope", scope="…"` that a client responds to by silently re-authorizing. DPF's existing `structuredContent.error = "insufficient_token_scope"` with `requiredScope` carries *exactly* this information — but as a tool-result payload whose documented remedy is "stop the MCP workflow and surface the required scope to the operator," i.e. a human mints a wider token. Same data, one is a flow and one is a halt. This is the single highest-leverage item in the design and it is nearly free (§5.4).

**Comparable implementations.** The remote-MCP-server population (GitHub, Linear, Sentry, Notion, Atlassian) converged on the same shape: PRM at the well-known path, `resource_metadata` in the 401, DCR accepted for clients with no prior relationship, PKCE-S256 required, short access tokens with refresh. Nothing in this design is novel; the value is in binding it to DPF's existing grant model rather than inventing a parallel one.

---

## 4. Design

### 4.1 Shape

The portal is both resource server and authorization server. On a local install they are the same origin, which makes discovery trivial and keeps the whole flow inside the box — consistent with `EP-24741BBF`'s absorption stance and with the operator's fully-local posture. Nothing in this design requires an external IdP; §9 keeps federating to one as an *option* rather than a dependency.

```
  MCP client                     Portal (RS + AS)
      |  POST /api/mcp/v1 (no token)      |
      |---------------------------------->|
      |  401 + WWW-Authenticate:          |
      |    resource_metadata=..., scope=  |
      |<----------------------------------|
      |  GET /.well-known/                |
      |      oauth-protected-resource     |
      |---------------------------------->|
      |  { authorization_servers: [...] } |
      |<----------------------------------|
      |  GET /.well-known/                |
      |      oauth-authorization-server   |
      |---------------------------------->|
      |  { authorize, token, register,    |
      |    client_id_metadata_document_   |
      |    supported, ... }               |
      |<----------------------------------|
      |  register (DCR) or CIMD client_id |
      |---------------------------------->|
      |  browser: /oauth/authorize        |
      |    + PKCE S256 + resource + scope |
      |==== operator consents in portal ==|
      |  code -> /oauth/token + verifier  |
      |---------------------------------->|
      |  access_token (+ refresh_token)   |
      |<----------------------------------|
      |  POST /api/mcp/v1 + Bearer        |
      |---------------------------------->|
```

The operator's experience is: point the client at the URL, a browser tab opens, they approve a named client and a named scope set in a portal screen they already recognise, and it never asks again. No env var. No copy-paste. No restart.

### 4.2 Endpoints

| Path | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 PRM, root form. `resource`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported: ["header"]`. |
| `/.well-known/oauth-protected-resource/api/mcp/v1` | RFC 9728 PRM, path-suffixed form. Same document. Both are served because clients try them in a defined order (`:96-101`). |
| `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata. Advertises `code_challenge_methods_supported: ["S256"]` only, `client_id_metadata_document_supported: true`, and `registration_endpoint` when DCR is enabled. |
| `/api/oauth/authorize` | Authorization endpoint. Requires an authenticated portal session; renders the consent screen. |
| `/api/oauth/token` | Token endpoint. `authorization_code` + `refresh_token` grants. PKCE verifier required. |
| `/api/oauth/register` | RFC 7591 DCR. Policy-gated (§7.3). |
| `/api/oauth/revoke` | RFC 7009 revocation. |

`scopes_supported` is the **minimum set for basic functionality**, per `:344-347` — the read-tier grant set, not the whole 34-grant development template. Everything above it arrives through step-up (§5.4), which is what makes least-privilege actually reachable instead of aspirational.

### 4.3 Mapping onto the existing authorization model

This is the load-bearing decision and it is a projection, not a new model.

- **OAuth scope strings are the existing grant names.** `scopes_supported` enumerates the same grant vocabulary `expandGrants` already understands (`registry_read`, `file_read`, …), plus the three coarse tiers. No second vocabulary, no mapping table to drift.
- **An issued access token resolves to the same `ResolvedMcpToken` shape** the PAT path produces — `{ tokenId, userId, agentId, scope, scopes, capability }`. `resolveMcpApiToken` gains a sibling resolver; `tokenCanUseTool`, `resolveListingAuthorityForToken` and `governedExecuteTool` are not modified. **This is the single most important constraint in the design: if the OAuth path needed a different authorization gate, it would be a fork, and a fork of the authorization gate is how false-green authorization bugs are born.**
- **The consenting human is the `userId`.** Their `platformRole` still caps everything through `resolveWorkforcePlatformRole`; a token cannot grant what the human does not have. Consent narrows, never widens.
- **Agent binding is preserved.** Where a token is bound to an `agentId`, the agent-grant and `sensitivityClearance` axes apply exactly as today, including `tools/list` ⇄ `tools/call` parity.
- **Storage reuses `McpApiToken`** with a new `kind` (`oauth_access`) plus a sibling row or table for refresh tokens, `client_id`, `resource` audience and expiry. Revocation, the admin list, `lastUsedAt` and the audit trail come along for free. A `dpfmcp_` PAT and an OAuth access token are the same governed object with different issuance paths.

### 4.4 Client registration

Support all three of the spec's mechanisms, and let the install's own posture pick:

1. **CIMD (SEP-991)** — preferred where the install can reach the internet. `client_id_metadata_document_supported: true` in AS metadata. The AS fetches the document, validates `client_id` matches the URL exactly, validates the request's `redirect_uri` against the document, and caches per HTTP cache headers (`:236-239`).
2. **DCR (RFC 7591)** — the local-install path, because it needs no outbound fetch. Policy-gated (§7.3).
3. **Pre-registration** — an operator-managed client list in Admin > Platform Development, for a client the operator wants pinned.

### 4.5 Redirect URIs

CLI clients use a loopback listener (`http://127.0.0.1:<ephemeral>/callback`); this is the OAuth 2.1 native-app pattern and the one Claude Code, Codex and VS Code use. The AS permits loopback with an arbitrary port per RFC 8252 §7.3, exact-matches every other redirect, and refuses a wildcard. Custom-scheme redirects are accepted only from a pre-registered or CIMD client that declares them.

### 4.6 Consent screen

A portal route, reusing the live session — the operator is already signed in as an admin, so this is a click, not a login. It names, in the platform's own vocabulary rather than OAuth's:

- the requesting client (`client_name`, and for DCR the fact that it self-registered — an honest weaker provenance signal);
- the **resource** it will be able to act against, i.e. this named installation (`.well-known/dpf-instance.json` already carries installation identity — reuse it, and close `BI-C7151B1B`'s complaint that the handshake never names which installation an agent is connected to);
- the scope set in plain language, with the write/admin tiers visually distinct;
- who is granting (the acting human and their role cap).

Approvals are recorded as `AuthorizationDecisionLog` rows and listed in Admin > Platform Development > MCP beside PATs, each individually revocable.

---

## 5. Slices

Each slice is independently shippable and independently valuable. Slice 1 is worth landing on its own even if the programme stops there.

### Slice 1 — Discovery (small)

Serve both PRM documents; add `resource_metadata` and `scope` to the 401 challenge. **No authorization server yet** — `authorization_servers` points at the portal, whose AS metadata is added in Slice 2.

The point of shipping this first: today a client fails with a dead end. After Slice 1 it fails with a *machine-readable pointer*, and every conformant client's error message improves from "connection failed" to something the operator can act on. It also makes the conformance defect against the `2025-11-25` revision we already advertise go away.

### Slice 2 — Authorization server core (large)

AS metadata; `authorize` + `token`; authorization-code with mandatory PKCE-S256; refresh tokens; consent screen; loopback redirect handling; `resource` (RFC 8707) validation on both requests; audience validation on the resource server. Access tokens short-lived (recommend 1h, §9); refresh tokens long-lived and rotating.

### Slice 3 — Registration (medium)

DCR with policy gate; CIMD fetch/validate/cache; operator pre-registration UI. Registered clients listed and revocable.

### Slice 4 — Step-up authorization (small, high value)

Convert the runtime scope refusal into a flow. Where the transport today returns a tool result carrying `structuredContent.error = "insufficient_token_scope"` and `requiredScope`, an **OAuth-authenticated** caller instead receives:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope",
                  scope="<granted scopes> <newly required scopes>",
                  resource_metadata="…/.well-known/oauth-protected-resource",
                  error_description="…"
```

Following the spec's *recommended* inclusion strategy (`:520-524`): return existing granted scopes **plus** the newly required ones, so the client does not lose ground on re-authorization. The client re-authorizes, the operator sees a consent screen naming exactly the additional authority, and the original call is retried.

This is the moment the platform's scope-escalation rule stops being a human interrupt. The rule in AGENTS.md — *never route around a scope refusal via psql, Prisma or direct DB edits* — is unchanged and is in fact easier to obey once the sanctioned path is one browser click instead of a token-minting errand. **PAT callers keep the existing `insufficient_token_scope` tool-result contract byte-for-byte**; only the OAuth path gets the 403 challenge, so nothing that reads the old contract breaks.

### Slice 5 — Contract convergence (medium)

Rewrite `route.ts:10-14` to state the two-door contract. Update the [MCP tool authorization runbook](../../architecture/mcp-tool-authorization-runbook.md): diagnosis order #2 currently says a 401 means "rotate or reseed the local client configuration," which stops being the right first move once a 401 is self-healing. Update the portal's setup surface to lead with "connect via browser" and present the PAT as the headless option. Revisit the `isAllowedMcpEndpoint` posture per §7.4.

**Backlog coverage.** Each slice gets a `BacklogItem` linked to `BI-E4DFDCB0` before implementation begins, per `scripts/check-plan-backlog-coverage.mjs`. Not Markdown checkboxes — that is precisely the failure this item exists to correct, and repeating it here would be embarrassing.

---

## 6. What this does not change

Stated explicitly so review can hold the line:

- The scope × grant intersection, agent-grant filter, clearance axis, and `tools/list` ⇄ `tools/call` parity.
- `governedExecuteTool`, the `ToolExecution` audit row, `AuthorizationDecisionLog`.
- Tool tiers, `?tier=full` bootstrap for Claude Code and Codex, `load_tools` progressive disclosure, the frozen tool-name contract.
- The `X-MCP-Session` internal JWT seam for in-portal coworkers.
- The `dpfmcp_` PAT — issuance, rotation, revocation and every current client config keep working unchanged.
- Protocol version negotiation and the N/N-1 window.

---

## 7. Security

### 7.1 Non-negotiables from the spec

PKCE-S256 mandatory (no `plain`, no omission). `resource` required on authorization and token requests, and the resource server **MUST** reject a token whose audience is not itself (`:469-483`) — this is what stops a token minted for one DPF install being replayed at another. Tokens never in a query string. Exact redirect matching outside the loopback exception. Authorization codes single-use and short-lived.

### 7.2 No token passthrough

The `2025-11-25` prohibition (and the TAK/GAID design's §MCP notes) is absolute: the portal must never forward a user's token to an upstream MCP server. Upstream calls use the portal's own client credentials, with the acting `gaid` and `principal_ref` carried in receipts and W3C trace headers — never inside the bearer token.

### 7.3 DCR abuse

An open `/register` on a reachable install lets anyone mint a `client_id`. Registration alone grants nothing — every token still requires an authenticated human to consent — but unbounded registration is still a junk-row and phishing-surface vector (a self-registered client can choose a misleading `client_name`, which the consent screen must therefore mark as self-asserted). Mitigations: DCR enabled by default **only** when the resource origin is loopback; rate limiting; registrations expire unused; the operator can disable DCR entirely and require CIMD or pre-registration. §9 puts the default to the operator.

### 7.4 The loopback guard

`isAllowedMcpEndpoint` stays. What changes is that it is no longer the *only* thing standing between an ambient config file and a disclosed credential, because the OAuth path puts no long-lived secret in ambient config at all. Slice 5 revisits whether a **discovered, audience-bound** non-loopback endpoint should be permitted for the OAuth flow specifically, while a config-resolved `dpfmcp_` PAT stays loopback-only forever. That is a narrowing of the rule to the credential shape that actually needs it — and it is the concrete mechanism by which `BI-1819D34F` shrinks.

### 7.5 Local HTTP

A local install serves `http://127.0.0.1:3000`. OAuth 2.1 requires TLS except for loopback, which is exactly the carve-out that applies. Any non-loopback exposure requires HTTPS, and the AS must refuse to issue for a non-loopback `resource` over plain HTTP. `docker-compose.tls.yml` and the organization PKI already exist for installs that go beyond the box.

---

## 8. Verification

Structural checks are necessary and not sufficient — `structural-verification-is-not-functional` is a commandment, and a 200 from a metadata endpoint proves nothing about whether a client can connect.

**Conformance (automated).** PRM documents validate against RFC 9728 at both paths; AS metadata validates against RFC 8414; 401 carries a parseable `resource_metadata` and `scope`; PKCE `plain` is refused; a missing/mismatched `resource` is refused; a token minted for audience A is refused at audience B; an authorization code cannot be replayed; a non-loopback redirect must match exactly.

**Authorization parity (automated) — the one that matters most.** For an identical `(user, agent, scope set)`, the OAuth-resolved token and the PAT-resolved token **MUST** produce byte-identical `tools/list` output and identical `tools/call` verdicts across the full tool surface, including the agent-grant and clearance axes. This is the guard against the fork risk in §4.3, and it should fail CI loudly.

**Step-up (automated).** A read-scoped OAuth token calling a write tool returns 403 with `error="insufficient_scope"` and a `scope` set containing both existing and newly required scopes. The same call on a PAT returns the unchanged `insufficient_token_scope` tool result.

**Functional acceptance (manual, per the commandment).** On a machine with **no `DPF_MCP_BEARER_TOKEN` set anywhere**: point a fresh Claude Code at the install's MCP URL with no credential configured; confirm the browser opens, the consent screen names the client and this installation by name, approval completes, and a governed read call and a governed write call both succeed. Then let the access token expire and confirm the client refreshes silently with no human involved. Then revoke from the portal and confirm the client is refused and re-prompts rather than hanging.

**Regression.** The existing PAT path — including this session's own token, `.mcp.json`, `?tier=full` bootstrap and `scripts/mcp-progressive-disclosure-conformance.mjs` — must pass unchanged.

---

## 9. Open operator decisions

Not hidden assumptions. Each changes behaviour and none should be settled by an implementer alone.

1. **DCR default.** Enabled on loopback only (recommended), enabled generally, or off with CIMD/pre-registration required?
2. **Access-token lifetime.** 1h recommended. Shorter increases refresh traffic on a local box for little gain; longer widens the replay window.
3. **Default consented scope.** `scopes_supported` as the read-tier minimum with step-up for everything else (recommended, and what makes least-privilege real), versus consenting the development template up front for fewer interruptions.
4. **Should OAuth become the default door in the portal's setup UI, with the PAT presented as the headless option?** Recommended yes at Slice 5, not before.
5. **Federation.** `EP-24741BBF` scopes an identity edge (LDAP/OIDC/SAML/SCIM) and `2026-04-22` contemplated authentik. This design deliberately makes the portal its own AS so a local install needs nothing external. If an identity edge later lands, `authorization_servers` can point at it instead — the PRM indirection is exactly the seam that makes that a config change rather than a redesign. Confirm that ordering.

---

## 10. Non-goals

- Removing or deprecating the `dpfmcp_` PAT.
- Changing the authorization model, tool grants, tool names, tool tiers or the protocol version window.
- Making DPF an MCP **client** with OAuth (outbound to third-party servers) — related, separately owned, out of scope here.
- Building a general-purpose OAuth provider for non-MCP surfaces. The AS is scoped to the MCP resource; broadening it is `EP-24741BBF`'s directory work, not this item.
- Re-specifying the consumer bootstrap (`BI-ED1BBC9E`). Sequenced ahead of this, designed elsewhere, amended on its own item.
