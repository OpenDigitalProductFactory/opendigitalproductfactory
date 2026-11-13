# Preserve admitted native nested authority

Status: design proposal; no implementation approval or passing regression claimed.

Implementation item: BI-5163AF47. Workroom: WC-1D5431B1.
Related item: BI-907D6878, whose original three acceptance criteria remain independent.
Source examined: `95d9746940171a45af9f6bed76208e2e4ab07742`.

## Objective and authority boundary

Governed native terminal writers must retain only their originally admitted nested
reader authority while visible tools and current authorization checks remain
constrained. A restricted tool presentation must not accidentally erase an
admitted right needed inside the writer. It must not create that right either.

The coordinator separated this corrective deliverable under the operator's
standing repair authorization and decision DI-B33573A0E133. This is owner scope
input, not independent design approval, a scope baseline, or implementation
permission. Normal design admission is IRD-8B6B517FFDDC. The item-specific
operator organization shared-platform refactor funding binding executed on November 12;
normal provider, allowance and review-admission controls still apply. This
document does not authorize a paid dispatch.

## Observed current source

The loop constructs `mcpSession` in `apps/web/lib/tak/agentic-loop.ts:1058`
without the admitted token grants. Later it narrows provider tools to the terminal
writer. `apps/web/lib/routing/cli-adapter.ts:366` derives JWT scopes from those
visible tool mappings, then adds `backlog_read`. The session token already carries
task identity and an execution fence, but not a separate nested authority or
presentation constraint.

`apps/web/app/api/mcp/v1/route.ts:538` expands the JWT scopes and passes them as
`tokenGrantScopes` to governed execution. The nested guard in
`apps/web/lib/mcp-governed-execute.ts` requires the reader's mapped grant. The
controlled current-source counterexample is recorded as
`cmwcvdjgp4khb0emf3ypv4pnr`: writer-only scope derivation loses admitted
`file_read`; grant expansion does not recover it. This diagnostic is not a full
producer-to-dispatch regression or evidence of the fix passing.

The existing task binding transport from BI-B949993E is present and must remain.
PR6117 / BI-2E479619 provides native call-record and receipt-healing source reuse;
that does not establish acceptance of this authority repair. Native reader
records marked `metrics_only` or `nativeResultWithheld` remain insufficient reader
evidence.

Historical error-time images, session grants and the original 45-call cause
remain unknown. No historical task is replayed or foreign origin authority used.

## Delivery separation and overlap

BI-907D6878 retains native-call recording, terminal receipt recognition and bound
reader/writer schema listing. Its WC-7BF60EDC agreement remains the original
three-criterion digest. Schema binding can ship without correcting nested grant
loss. BI-5163AF47 therefore owns this separate authority repair; delivering it
cannot close BI-907D6878.

Live narrowed epic listings and knowledge search found related work, including
retired peer intake BI-D5F77757 and completed BI-B949993E, without an exact active
local authority carrier in the inspected results. Broad listings were truncated,
and the normal open-PR query timed out. These limits do not establish global
absence. No retired/foreign item was reopened or claimed. Recheck active overlap
before publication.

## Acceptance contract

The following are the exact captured body criteria, digest
`sha256:e901af10b882df7adb41c08d916749a06ca00f9d45425b5114f6cce6965f9ccd`:

1. With file_read originally admitted, a native terminal-writer-only session preserves the authority required for the governed writer's bound nested read_source_at_version.
2. Without an originally admitted reader right, or after applicable user/coworker revocation, the same nested operation remains denied.
3. Model-visible terminal tools remain narrowed; carrying admitted nested authority does not expose extra tools or weaken exact task, source, or execution-fence checks.
4. An isolated regression exercises the real native producer, session token verification, visible tools/list and governed nested dispatch, including positive and negative authority controls, and fails before the fix then passes after it.

## Options and proposed approach

Adding `file_read` to every native JWT is rejected: it invents authority for callers
that never admitted it. Deriving all authority from the visible writer is the
current failure. Adding admitted scopes to the ordinary JWT `scopes` alone is
also insufficient: the native tools/list handler selects tools using those
scopes, so additional reader grants can expand presentation.

Use the existing signed JWT `scopes` for authority and add a signed presentation
constraint. A second nested-grant claim is unnecessary: the route already feeds
verified scopes to the governed nested dispatcher, which checks every nested
operation separately. Reuse that mechanism rather than adding a parallel one.
Do not introduce a table, grant, role, external service or transport.

Proposed contract, subject to independent review:

- Add optional `admittedTokenGrantScopes` to `AdapterMcpSession`, populated only
  from `params.tokenGrantScopes` on the authenticated task-bound loop path. It
  is server context, never model arguments. Absence retains the ordinary legacy
  path; presence with an empty array refuses restricted native issuance rather
  than falling back to visible-tool grants.
- For that task-bound path, mint `scopes` from the original admitted grant set,
  without the existing unconditional `backlog_read` addition. Preserve the
  writer-derived read/write capability and all original task/fence fields;
  carrying grants must not upgrade capability or turn read-only work into writes.
- Add optional signed `toolSurface: { version: 1, toolNames: string[] }` to
  `McpSessionPayload`, and forward it through `ResolvedMcpTransportAuth`. The
  adapter derives the names from the final provider surface after terminal
  narrowing. A restricted session requires both admitted authority and this
  constraint; malformed or unknown versions fail verification.
- Mint restricted tokens with the single scalar audience
  `dpf-mcp-server-restricted-v1`, never the ordinary `dpf-mcp-server` audience
  and never an audience array. The restricted audience requires a coherent
  version-1 surface and the existing task/fence contract. The new verifier must
  explicitly reject arrays, a missing surface on the restricted audience, and
  a surface on the ordinary audience. Signature verification accepting either
  audience is not sufficient without these payload checks.
- Filter `handleToolsList` by the signed surface after existing user, token and
  coworker checks. Apply the same constraint in `handleToolsCall` before domain
  dispatch and before the special `load_tools` branch. Restricted sessions do
  not advertise the unrestricted loading meta-tool or accept its widening calls.
  This is specific to the signed restricted session; ordinary discovery remains.
- Keep nested `governedDispatch` unchanged: it receives the original expanded
  token scopes through the existing context, and still checks user/coworker
  authority, nested tool grants, capability, task/fence and exact source binding.
  A nested reader does not become a permitted direct model call merely because
  its grant is present. No direct-call allowlist is passed as nested authority.
- Validate surface size against the existing finite tool registry, canonical
  names, uniqueness, string types and supported version in one shared parser
  used by minting and verification. Treat an explicitly empty surface as empty,
  never as unrestricted. Preserve old tokens with no new claim. Do not enable
  the contract for the separate Codex read-only-session lane in this repair.
- If issuance of this restricted contract fails, refuse the native turn rather
  than use the existing text-tool fallback with lost constraints. Legacy turns
  retain their existing fallback behavior. Add a specific regression for this.

This placement follows inspected `session-token.ts`, `transport-auth.ts`,
`route.ts` and `mcp-governed-execute.ts`; code graph lookup corroborated the
existing `McpSessionPayload` home. It is design only. Product-path claims and
implementation admission are still required before changing these files.

### Mixed versions and rollback

A source-only synthetic probe of the real legacy `session-token.ts` verifier
confirmed a downgrade hazard in the first draft. With the old audience, it
accepted admitted reader/writer scopes and silently discarded `toolSurface`.
It rejected a distinct new-only audience. An array containing both audiences
was accepted and also lost the surface. The examined source SHA256 was
`d5efe21093c1f706a8495129d4f413c369b97cd3a45826030caaff86909f70c7`.
The coordinator executed that probe with synthetic signing material, real
verification, no network calls and no task/fence exercise. It is a concrete
compatibility counterexample, not runtime acceptance or an independent verdict.

The incompatible restricted audience makes an old receiver reject these tokens
before using their scopes. On a mixed-version deployment or rollback, refusal
must terminate that restricted native turn; the adapter must not remint with the
old audience, use dual audiences, remove the surface, or fall back to an
unconstrained native/text execution. Ordinary tokens without this contract keep
their old audience and existing behavior. This protocol boundary does not change
the issuer, signing authority, lifetime limits or task/source/fence checks.

The regression must execute the real verifier from the named pre-change source
against synthetic restricted tokens, rather than mock an old receiver's refusal.
It must demonstrate old-verifier rejection of the chosen audience and preserve
the old/dual-audience acceptance counterexamples as negative controls. Test the
new verifier's audience/surface coherence, array rejection, unsupported version,
missing surface and unsafe-fallback refusal as well as ordinary legacy success.

The MCP tools specification treats listing as a request-authorized surface;
this supports keeping authenticated session presentation explicit rather than
depending on connection history. See the [official MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
Scope semantics and the target service remain explicit in
[RFC 8693, section 2.1.1](https://www.rfc-editor.org/rfc/rfc8693.html#section-2.1.1).
These references inform the boundary; this repair does not add OAuth token exchange.

## Ordered implementation and verification plan

1. Record current-source reproduction and candidate-cause controls in the normal
   research lane. Establish canonical coverage for BI-5163AF47 against all four
   criteria. Finish exact session-claim design and independent review as required
   by current readiness. Claim affected source/test paths and consume their
   impact contract before edits. Obtain normal implementation admission.
2. Add an isolated failing regression using the real native adapter token
   producer, real token verifier, real tools/list handler and real governed nested
   dispatch. Stub provider/network, persistence and immutable-source IO only.
   Use synthetic signing material, never installation credentials. Capture the
   failing scope loss on the named base without interpreting it as a repair pass.
3. Extend the existing adapter/session contract and narrowly transport admitted
   nested authority plus presentation constraints. Implement route consumption
   and negative validation with no broad grant additions or policy bypasses.
4. Make the isolated regression pass. Cover missing, empty and revoked authority;
   altered task/fence/source; forbidden direct reader calls; listing/deferred-load
   widening; malformed claims; mixed-version and rollback audience downgrade;
   and unchanged ordinary/read-only session behavior.
   Run affected token, adapter, route, nested-dispatch and review-binding suites
   plus package typechecks under managed dependency readiness.
5. Run the required exact-tree governed verification and independent committed
   review, then signed protected PR and merge queue. Reuse valid evidence without
   duplicating uncertain tasks. Canonical deployment belongs to the existing
   sole upgrade owner; this chat does not advance the install independently.
6. Verify the admitted positive path and denial controls on the served canonical
   target with new authorized fixtures. Record acceptance for this item alone.
   Original integration, offline recovery and document lifecycle acceptance are
   still separately owed.

## Compatibility, risks and rollback

No database migration is proposed. Tokens are short-lived; legacy token behavior
must have explicit tests. New restricted contracts must fail closed if malformed
or unsupported, rather than silently dropping constraints. Ordinary sessions
must not acquire nested rights from this change.

The principal risks are authority expansion, presentation widening, stale task
binding, and confusing evidence metadata with a successful immutable read. Each
has a denial/control case above. Rollback uses the normal protected source and
canonical release process; do not edit live tokens, fabricate receipts or replay
uncertain reviewer tasks.

## Current verification status and stop condition

Design source inspection and normal design admission are complete. The
existing token, transport-auth and adapter grant/capability suites passed: 47
tests across three suites on the unchanged base. They are baseline controls,
not a failing-then-passing proof of this repair. Document index, links and
whitespace checks passed. Managed dependency bootstrap reports compile-ready.

### Executed source reproduction (November 12)

The normally admitted test path is
`apps/web/lib/routing/native-session-authority.test.ts`. On design head
`d3c6d2bff8b93fa2c027ac3e222eaddd90bcb86d`, whose product source remains
`95d9746940171a45af9f6bed76208e2e4ab07742`, the isolated regression executed:
**one failed, two passed**. Its real writer-only CLI adapter stages the signed
MCP token; the real verifier, authentication boundary and tools/list accept the
writer. Calling that writer reaches the real governed nested dispatcher, which
refuses its immutable reader because the producer omitted originally admitted
`file_read`. This is the assertion failure, not an import or provider failure.

Two causal controls pass: supplying the originally admitted reader grant in an
ordinary token lets the same nested dispatcher reach synthetic immutable-source
IO, while a native session without admitted reader authority remains denied.
The passing control isolates the grant-loss cause; it is not a repaired producer
or a product GREEN. The fixture uses synthetic signing material and identities;
process/provider, persistence, source IO and governance preflight/authority-input
seams are isolated. It does not prove full live task/source/revocation behavior.

The actual command was `node scripts/host-resource-runner.mjs --class vitest --
pnpm --filter web exec vitest run lib/routing/native-session-authority.test.ts
--maxWorkers=1`. Existing resumer execution under `NPEL-F2FF00407E` /
`TR-NONPROD-80492191B978A20EC06A845E` finished at 04:56:37 UTC on November 13.
Earlier harness import and synthetic CLI-envelope failures are retained as
harness failures, not counted as product RED. The preceding queued run settled
before this changed-source run was requested; no duplicate runner was started.

Product changes, product GREEN, current typechecks, full negative controls,
runtime verification, independent reviews, PR and deployment remain unrun. The
draft is linked to the live build/medium item. Record author research and obtain
normal implementation admission and product-path claims before production
edits. Stop a denied admission or scope operation and follow its exact remedy.
Never repair a frozen agreement by editing stored JSON.
