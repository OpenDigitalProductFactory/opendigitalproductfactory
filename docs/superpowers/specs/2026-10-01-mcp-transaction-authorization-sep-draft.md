---
status: draft
---

# MCP extension draft: transaction-bound authorization for consequential tool calls

| | |
|---|---|
| Date | 2026-10-01 |
| Epic | EP-B932453F |
| Backlog | BI-899C3844 |
| Parent design | [GPP model to execution, Part III](2026-10-01-gpp-model-to-execution-design.md) |

> **INTERNAL DRAFT — external submission requires explicit founder authorization.**
>
> Nothing here has been posted, discussed or filed outside DPF. Drafted 2026-10-01 for EP-B932453F /
> BI-899C3844
> (design spec `docs/superpowers/specs/2026-10-01-gpp-model-to-execution-design.md`, Part III and
> Phase 6). A DPF server-side reference implementation now exists in shadow mode (GPP Phase 2,
> PRs #5899, #5900, #5901, #5913); no official-SDK prototype exists.

## Corrections to the design spec, Part III

This draft supersedes the outline in
[`2026-10-01-gpp-model-to-execution-design.md` §6](2026-10-01-gpp-model-to-execution-design.md#6-part-iii-beyond-mcp-a-transaction-scoped-authorization-extension)
on these points. The spec itself is left unchanged so that its approved baseline stays valid:

- **Overlap check (spec §6, sequence step 3) is done.** Two open SEPs matter: SEP-2643 (structured
  authorization denials) and SEP-2848 (asynchronous approval). The draft extends them rather than
  defining a separate `permit_required` result. The SEPs the spec cites (2322, 1036, 2133, 2663) are
  Final; the spec's statement that no Final SEP covers per-call authorization still holds.
- **Carriage key.** `_meta["com.opendigitalproductfactory/authorization-handle"]`, not
  `io.opendigitalproductfactory/permit`. The project serves `opendigitalproductfactory.com`
  (`docs/CNAME`), so the reverse-DNS prefix is `com.`.
- **Binding.** The server computes the argument digest from the call it received; the client never
  supplies a proof-of-possession digest.
- **Attenuation** stays an open question (Open Question 4) rather than a rule, because an opaque handle
  cannot be attenuated by an intermediary without a standard encoding.

## Before this could be filed (process facts, verified 2026-10-01)

- **Prior discussion is required.** The PR must link to an earlier discussion in the relevant
  working or interest group. A SEP without one is not accepted
  ([SEP guidelines](https://modelcontextprotocol.io/community/sep-guidelines)). Since 2026-09-22,
  maintainers have been closing SEPs that were not developed with a Working Group
  ([closing comment on PR #2385](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2385)).
- **Likely home.** The [Authorization IG](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/community/interest-groups/auth.mdx)
  describes itself as "the single chartered venue for MCP authorization work" and lists structured
  denials and remediation hints in its scope. SEP-2643 and SEP-2848 both name an "MCP Fine-Grained
  Authorization Working Group", but `docs/community/working-groups/` on `main` has no charter for
  it. The annotation half also belongs to the
  [Tool Annotations IG](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/community/interest-groups/tool-annotations.mdx).
- **Extensions Track needs a reference implementation in an official SDK before review**, plus an
  associated WG or IG ([Extensions overview](https://modelcontextprotocol.io/extensions/overview)).
- **The spec repository accepts PRs from collaborators only** (SEP guidelines, step 3).
- **AI assistance must be disclosed** in the PR
  ([AI_POLICY.md](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/AI_POLICY.md)).
  One agent-related SEP was closed for that reason ([PR #3246](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3246)).
- **Overlap.** This draft extends two open SEPs rather than competing with them:
  [SEP-2643 Structured Authorization Denials](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2643)
  and [SEP-2848 Asynchronous Approval for Tool Calls](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2848).
  The recommended first move is to bring §Specification to their authors in the Auth IG as a new
  SEP-2643 remediation-hint type plus a small extension, not to file a standalone SEP.

---

## SEP-{NUMBER}: Transaction-Bound Authorization for Consequential Tool Calls

- **Status**: Draft — not submitted
- **Type**: Extensions Track
- **Created**: 2026-10-01
- **Author(s)**: Mark Bodman (Open Digital Product Factory)
- **Sponsor**: None (seeking sponsor)
- **Extension Identifier**: `com.opendigitalproductfactory/transaction-authorization`
- **Requires**: `io.modelcontextprotocol/structured-authorization-denials` (SEP-2643)
- **PR**: {to be assigned}

### Abstract

MCP authorizes at the level of the server and the OAuth scope. Clients add per-tool allow / ask /
deny rules on top. Neither can express the authorization that consequential agent actions need:
*this* call, with *these* arguments, admitted by *this* recorded decision. This SEP defines an
optional extension with three parts. First, a tool declaration says that a tool requires
transaction-bound authorization, and names the consequence class that makes it consequential
(outward, authority-changing or irreversible). Clients and servers can then concentrate scrutiny
on the few calls that matter instead of prompting on every call. Second, a request-side `_meta`
field carries an opaque authorization handle that the server binds to the exact call: tool, a
digest of the arguments, and validity. Third, a remediation-hint type for the SEP-2643 denial
envelope tells the agent which decision gate issues a handle, and how to reach it, when a handle
is missing, invalid or does not cover the arguments. Verification happens at the server and is
authoritative. Client-side handling only speeds things up. A tool with no declaration behaves
exactly as it does today.

### Motivation

#### The gap in the current specification

- MCP authorization (2026-07-28) is transport-level OAuth 2.1 with RFC 8707 resource indicators
  and RFC 9728 metadata. Runtime step-up asks for more *scopes*
  ([Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)).
  A scope covers a class of operations for the token's lifetime, not a specific call.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are
  hints. "Clients **MUST** consider tool annotations to be untrusted unless they come from trusted
  servers" ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). None of
  them says that authorization is needed or how to obtain it.
- The specification's answer for consequential calls is a client-side human prompt: clients
  "**SHOULD** … Present confirmation prompts to the user for operations" (Tools, User Interaction
  Model). Nothing on the wire carries the result of that confirmation, so a server cannot verify
  that it happened, or what it covered.
- The specification describes a server-issued handle as "a name, not a capability" (Tools,
  Stateful Tools). It also requires that state spanning requests "**MUST** be referenced by an
  explicit identifier the client passes on each request"
  ([Overview, Statelessness](https://modelcontextprotocol.io/specification/2026-07-28/basic/index)).
  A protocol that is stateless per request needs an explicit, verifiable reference to a prior
  authorization decision. Today there is none.

#### Why per-tool allow / ask / deny is insufficient

Per-tool rules have two outcomes in practice. If a consequential tool is set to *ask*, the person
is prompted on every call. If it is set to *allow*, the agent's standing credential becomes its
authority. DPF's research brief (*AI Agent Governance: Market and Thought-Leadership Landscape
2026*, `docs/architecture/agent-governance-market-landscape-2026.md`) collects the evidence that
per-call prompting fails as a control:

- Users approve about 93% of permission prompts. The figure is vendor-reported
  ([Anthropic Engineering, 2026-03-25](https://www.anthropic.com/engineering/claude-code-auto-mode)).
- Users approve 97% of prompts but reject 39% of plans. In a controlled study (n=1,053), people
  caught a disguised dangerous command 13.6% of the time: about 17% early in a session and about
  5% after 50 or more prompts. Vendor-reported
  ([Claude blog, 2026-08-07](https://claude.com/blog/auto-mode-default-in-claude-code)).
- Adherence to security warnings declines with repeated exposure in field conditions
  ([Vance et al., MIS Quarterly 42(2), 2018](https://misq.umn.edu/pub/skin/frontend/default/misq/pdf/V42I2/14124_RA_VanceJenkins.pdf)).
- Repeated approval prompts become an attack surface. MFA push-bombing was the entry vector in the
  2022 Uber breach
  ([BleepingComputer](https://www.bleepingcomputer.com/news/security/mfa-fatigue-attacks-are-putting-your-organization-at-risk/amp/)).
- The 2024–2026 incident record the brief compiles repeats one pattern: an agent held authority
  broader than its task, and nothing evaluated the specific damaging action. One example is the
  Replit production-database deletion during a declared code freeze
  ([Fortune, 2025-07-23](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure)).

The gap between 39% plan rejection and 97% prompt approval is the useful signal. People supervise
well when asked about a decision and poorly when asked about each call. An agent therefore needs a
way to present proof of the decision with each consequential call, and the server needs a way to
check that proof. Per-tool rules cannot do this, because the rule does not change between a call
that a decision covered and one it did not.

The extension also has to stay out of the way. Gating every call recreates approval fatigue at the
protocol layer. Most calls (reads, internal writes) need nothing new. The declaration exists so
that only the calls that matter carry the extra requirement.

### Specification

The key words MUST, SHOULD and MAY are used as described in RFC 2119.

#### 1. Capability negotiation

A server that implements this extension advertises it in `capabilities.extensions` of its
`server/discover` result. A client advertises it in
`_meta["io.modelcontextprotocol/clientCapabilities"].extensions`, as described in
[SEP-2133](https://modelcontextprotocol.io/seps/2133-extensions).

```json
"com.opendigitalproductfactory/transaction-authorization": {
  "handleFormats": ["opaque"],
  "bindings": ["class", "exact"]
}
```

#### 2. Tool declaration

A server MAY declare, in a tool's `_meta`, that calls to the tool require a transaction-bound
authorization handle:

```json
{
  "name": "payments_send",
  "inputSchema": { "...": "..." },
  "_meta": {
    "com.opendigitalproductfactory/transaction-authorization": {
      "required": true,
      "consequence": ["outward", "irreversible"],
      "binding": "exact"
    }
  }
}
```

- `consequence` (array, REQUIRED). One or more of `outward` (an effect visible outside the
  system: sending, publishing, paying), `authority` (granting, revoking or changing identity or
  approval), or `irreversible` (the effect cannot be undone by the system). Servers MUST NOT
  declare the requirement for tools with none of these consequences.
- `binding` (string, REQUIRED). `class` means a handle admits the tool for a bounded scope of
  work, such as a stage, without fixing the arguments. `exact` means a handle admits only calls
  whose arguments match the digest bound into it (§4).
- A tool without the declaration has today's behaviour. This extension adds no requirement to it.

The declaration is a hint (see Security Implications). Clients MAY use it to decide where to spend
human attention, for example by asking for the decision before the call rather than prompting on
each call. Clients MUST NOT treat the absence of the declaration as evidence that a tool is safe.

#### 3. Carrying the handle

A client that holds a handle for a call places it in the request's `_meta`:

```json
{
  "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": {
    "name": "payments_send",
    "arguments": { "payee": "acct_42", "amount": "120.00", "currency": "EUR" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { "extensions": { "...": {} } },
      "com.opendigitalproductfactory/authorization-handle": "<opaque>"
    }
  }
}
```

- The handle is an opaque string. Clients MUST NOT parse it or derive meaning from it.
- The handle is not an OAuth access token. It does not replace the `Authorization` header and MUST
  NOT be sent to any server other than the one that issued it or named it in a remediation hint.
- A client obtains handles only through the remediation paths in §5, or from the `_meta` of a
  result that completes a gate (§5.3).

#### 4. Server verification (authoritative)

For a tool that declares the requirement, the server MUST verify the following before performing
any part of the operation. The checks are separate from, and in addition to, OAuth token
validation:

1. A handle is present and was issued by an authority the server trusts.
2. The handle is unexpired, unrevoked and within its use limit.
3. The handle admits this tool.
4. For `binding: "exact"`, the server computes a digest over the canonical form of
   `{name, arguments}` (JCS, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), with SHA-256) and
   it equals the digest bound into the handle. The client never computes or sends the digest. The
   server derives it from the call it actually received.
5. Any context the handle is scoped to is still current, for example the unit of work or stage
   it was minted for.

If a check fails, the server MUST NOT execute the operation. It returns a SEP-2643 denial (§5).
A server that implements this extension MUST enforce these checks whether or not the client
advertised the extension. Client advertisement changes how the denial is expressed, never whether
the call is refused. A server MAY run a declared tool in an observe-only mode, recording what it
would have refused without refusing. It MUST NOT then advertise `required: true` for that tool.

#### 5. Denial and remediation

A failed check is returned as a `CallToolResult` with `isError: true`, carrying the SEP-2643
envelope with `reason: "insufficient_authorization"`. This SEP adds one remediation-hint type,
`transaction_authorization`:

```json
"_meta": {
  "io.modelcontextprotocol/authorization": {
    "reason": "insufficient_authorization",
    "remediation": "available",
    "authorizationContextId": "authzctx_51e0",
    "remediationHints": [{
      "type": "transaction_authorization",
      "condition": "handle_required",
      "gate": {
        "gateRef": "gate_8f2c",
        "title": "Finance approval for outbound payments",
        "obtain": "tool",
        "tool": "request_decision"
      }
    }]
  }
}
```

- `condition` (REQUIRED) is one of:
  - `handle_required`: no handle was presented.
  - `handle_invalid`: the handle is unknown, expired, revoked, exhausted or failed verification.
  - `handle_mismatch`: the handle is valid but does not cover this tool, these arguments or this
    context.
- `gate` describes where a handle comes from. `gateRef` is an opaque reference the client passes
  to the gate. `title` is display text. `obtain` is one of:
  - `tool`: call the named tool on this server, passing `gateRef`.
  - `url`: the decision is completed by the user through URL-mode elicitation
    ([SEP-1036](https://modelcontextprotocol.io/seps/1036-url-mode-elicitation-for-secure-out-of-band-intera)),
    carried as an `InputRequiredResult` ([SEP-2322](https://modelcontextprotocol.io/seps/2322-MRTR)).
  - `task`: the decision is made out of band and the server holds the call as a task, per SEP-2848.
  - `out_of_band`: a human or system outside MCP decides, and the client has no action to take.

##### 5.1 Client behaviour

- A client MUST NOT retry the same call unchanged after any of these conditions.
- On `handle_mismatch`, a client MUST NOT alter the arguments to fit an existing handle unless the
  user or the plan that produced the call directed the change.
- Clients SHOULD present the gate's `title` to the model and the user as the next step, so that
  the agent pursues the decision instead of searching for another tool that achieves the same
  effect.

##### 5.2 Information limits

The SEP-2643 rule applies: hints MUST NOT disclose information that would itself need
authorization to read. A server that cannot safely describe the gate uses
`remediation: "undisclosed"` with no hint.

##### 5.3 Handle issuance

When a gate admits, the server returns the handle in the `_meta` of the result that completes the
gate, under `com.opendigitalproductfactory/authorization-handle`, together with `expiresAt` and the
tools it admits. For the `task` path, the server MAY execute the held call directly on admission,
as SEP-2848 specifies, and no handle needs to reach the client.

### Rationale

**Why a client-carried handle, if the server could record approval state (SEP-2643 Use Case 1,
SEP-2848)?** There are three reasons. MCP is stateless per request and requires state that spans
requests to be referenced explicitly. The authority that decides is often not the tool server:
it may be a platform, organization or professional decision service whose verdict must cross a
boundary as a verifiable reference. And one decision often legitimately covers many calls
(`binding: "class"`). SEP-2848 handles one call that is held pending approval. This extension
handles a decision that admits a bounded class of later calls, and narrows it to exact arguments
where the consequence warrants. The two compose: `obtain: "task"` uses SEP-2848 unchanged.

**Why the server computes the argument digest.** If the client computed it, the client would be
the place where binding could be got wrong or forged. Deriving it from the received call keeps the
client simple and puts the check where enforcement happens. SEP-2848's immutable call binding takes
the same approach, with an optional RFC 8785 digest.

**Why reuse SEP-2643 instead of a new error.** SEP-2643 already defines a transport-agnostic
denial with a remediation posture and an extensible hint list, and it was developed in the
authorization community. A new hint type is the smallest change that tells the agent which gate to
go to, and avoids a second denial shape.

**Why the declaration lives in tool `_meta`, not in `ToolAnnotations`.** Adding to core
annotations is Standards Track work, and the Tool Annotations IG is coordinating many competing
annotation proposals. An extension key avoids touching core. The declaration could later move to
annotations, or be expressed as a requirement string under the proposed `execution.requirements`
([SEP-2487](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2487)).

**Prior art.**

- [RFC 9396 Rich Authorization Requests](https://www.rfc-editor.org/rfc/rfc9396.html) gives
  structured `authorization_details` for requesting fine-grained authorization.
- [draft-ietf-oauth-rar-metadata-remediation](https://datatracker.ietf.org/doc/draft-ietf-oauth-rar-metadata-remediation/)
  (OAuth WG, -00, 2026-08-23) defines `insufficient_authorization` with structured remediation,
  for HTTP.
- [draft-rosomakho-oauth-txn-challenge](https://datatracker.ietf.org/doc/draft-rosomakho-oauth-txn-challenge/)
  (individual draft, -00, 2026-06-25) issues a signed per-transaction challenge that an
  authorization server exchanges for a token scoped to the approved operation. This is the closest
  OAuth analogue. Where the deciding authority is an OAuth authorization server, that draft (via
  SEP-2643's `authorization_remediation` path) is the better fit. This extension covers deciders
  that are not authorization servers.
- [OAuth Transaction Tokens](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/)
  (-11, 2026-07-30, WG consensus, waiting for write-up) propagate immutable, short-lived
  transaction context through a call chain inside one trust domain. A handle could be carried as,
  or reference, a transaction token where both parties are in the same trust domain.
- Macaroons, Biscuit and AP2 mandates supply the attenuate-only claim model and the split between
  intent and exact action, which `class` and `exact` mirror. Adopting any of their encodings is
  deliberately left out; the handle stays opaque.

### Backward Compatibility

The extension is fully additive. A tool without the declaration is unaffected. A client that does
not implement the extension ignores unknown `_meta` keys, and when it calls a declared tool it
receives an ordinary `isError` result whose text explains the requirement. That is the same
degraded path SEP-2643 defines. Servers can introduce the declaration per tool, starting in
observe-only mode, so no existing call starts failing until the operator chooses to enforce.

### Security Implications

- **Declarations are hints. Verification is the control.** A malicious server can omit or falsify
  the declaration. The guarantee comes only from the server-side checks in §4. A client's own
  policy MUST NOT be weakened because a declaration is present.
- **Handle confidentiality and replay.** A handle is a bearer reference within its scope. Servers
  SHOULD bind handles to the authenticated principal and client. They SHOULD set short expiry and
  use limits, and use `binding: "exact"` for outward and irreversible calls so that a captured
  handle cannot be replayed with other arguments. Handles MUST NOT appear in logs readable by
  parties not entitled to the underlying work.
- **Forgery.** Servers MUST make handles unforgeable to the client and to the model, for example
  with a MAC over the bound claims under a key the agent runtime cannot read. Where the agent
  runtime can reach the signing key or the store, forgery is detectable at best, not prevented.
  Implementations should state which applies.
- **Confused deputy and token passthrough.** A handle MUST NOT be forwarded downstream. This is
  consistent with the rule that MCP servers "MUST NOT accept or transit any other tokens"
  (Authorization, Token Handling).
- **Hint integrity and disclosure.** The SEP-2643 provisions on hint integrity and disclosure apply
  unchanged, including the rule that a client acts on a hint only with assurance that it came from
  the addressed server.
- **Prompt injection.** Untrusted content cannot mint a handle, because handles come only from
  gate completion. That moves the injection target from the call to the decision, so gates need
  the same input separation as any other decision surface.

### Reference Implementation

Server side, in shadow mode, in the Open Digital Product Factory (DPF) MCP server (GPP Phase 2,
merged 2026-10-01/02):

- Gate-minted permits for outward, authority and irreversible calls (#5899).
- Handles of the form `gpp1.<permitId>.<keyId>.<mac>`, where the MAC is HMAC-SHA256 over the
  permit's claims and the claims bind a server-computed digest of the call's canonical arguments
  (#5900).
- Per-binding enforcement with an empty enforced set at merge (#5901).
- Atomic single-use consumption, the remediation envelope on result
  `_meta["io.modelcontextprotocol/authorization"]`, and the minted handle on
  `_meta["com.opendigitalproductfactory/authorization-handle"]` (#5913).

The handle is carried on `tools/call` `_meta` under the key this draft proposes. The live install
records verdicts without refusing. It records permits as unsigned until the signing key is
provisioned, and lineage to the sealed decision ledger is checked but often unsealed. Extensions
Track also requires a prototype in an official MCP SDK, which is not yet planned.

### Open Questions

1. Should this be a new SEP-2643 hint type plus a thin extension (as drafted), or folded into
   SEP-2643 or SEP-2848 directly?
2. Should the declaration use tool `_meta`, `ToolAnnotations` or SEP-2487 `execution.requirements`?
3. Should `tools/list` hide declared tools when no applicable gate could admit them? The
   specification already allows the list to "vary by the authorization presented on the request"
   (Tools, Capabilities).
4. Should intermediaries (gateways, sub-agents) be allowed to attenuate a handle, and if so, does
   that need a standard encoding (Biscuit, Macaroons) instead of an opaque string?
5. Vendor prefix: settled as `com.opendigitalproductfactory/`. The project serves
   `opendigitalproductfactory.com` (`docs/CNAME`); the spec's `io.` prefix is superseded.
6. Is the `gate` descriptor too revealing of organizational structure for cross-organization
   servers, and should `title` be optional?
