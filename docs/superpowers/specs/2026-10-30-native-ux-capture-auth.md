---
status: active
---

# Native UX critique capture authentication

BI-A615654F / WC-8FBC108A. Existing consultation umbrella BI-0AABCD1F; same earlier intake also appears as BI-EBA897BD. Base fbe8c75ca511701a93a89103f7324aea84c4fb75.

## Objective and observed boundary

**OBJ-1:** An admitted external agent can save one organization-scoped draft critique without a browser cookie, with authenticated authorship and unchanged verdict/publication limits.

Fresh live profile/discovery confirms critique_capture, but native capture_ux_critique returns Unauthorized/capture_rejected. Current code substrate: apps/web/lib/mcp/packs/ux-critique-pack.ts drops handler user/context; apps/web/lib/actions/critique-entry.ts calls saveWikiOverlayEdit; apps/web/lib/actions/wiki-edit.ts calls requireUser/auth(). Existing action tests mock the save as successful and therefore cannot establish this complete boundary. This is source diagnosis plus an observed runtime refusal; canonical deployed-byte correspondence and repaired served proof remain pending.

Reuse the corpus draft/revision architecture in docs/superpowers/plans/2026-07-31-externalize-ux-design-critic-wsid.md and wiki overlay rules in docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md. BI-CCC2224D describes the same class of actor loss in Feature Brief, a different domain writer. BI-C28A2C75 owns original immutable review recovery, not capture persistence. Bounded backlog searches were incomplete; no related open PR was returned for critique capture. No new store, tool, schema, grant, identity or publication authority.

## Contract and ordered atomic repair

1. **MCP-to-draft regression:** exercise the actual ux-critique-pack handler through actual capture and overlay save logic with browser auth absent. Mock only external storage/runtime boundaries for deterministic source testing; do not replace captureCritiqueEntry or saveWikiOverlayEdit with success mocks. Verify saved draft/revision authorship and readback metadata. Test missing/mismatched authenticated context, no capability, ignored actor/org/verdict arguments, invalid critique, kernel/org protections and normal browser behavior. Existing graph advice maps the two action tests and pack test; new service paths have no graph links, so include pure critique and wiki service tests too.
2. **Shared overlay writer:** extract existing overlay persistence into server-only apps/web/lib/wiki/save-overlay.server.ts, preserving org/kernel scope, revision/link handling and promotion/embedding conditions. Keep browser revalidation in its public action wrapper: an absent framework cache context must not turn an already-saved native draft into a false failure. The craft viewer is force-dynamic and reads stored data directly. Keep the public browser action signature and requireUser authentication. The internal writer receives a server-resolved actor; never export an actor-accepting `use server` action callable by a client.
   Preserve the narrow capture authority on title collisions: native agent capture creates a new draft or refuses, never replaces any existing page. Extend packages/db/src/wiki-store.ts with a create-only helper sharing its existing normalization; use the existing non-null organization/slug unique constraint for atomic collision rejection, not a read-then-upsert check. Browser wiki editing retains its existing upsert path. Two new boundary cases on source1202 returned success while replacing a same-title draft/published human finding, so that source must not be published as complete. This is protection of the existing agent-proposed-draft contract, not new editing or publication authority.
3. **Shared capture workflow:** extract validation/draft/media coordination into server-only apps/web/lib/ux-critique/capture-entry.server.ts with an internal writer dependency. Browser action uses its existing authenticated overlay wrapper; MCP uses the same core with the verified dispatcher actor. Keep CritiqueEntry shape, forced draft and agent-proposed calibration exclusion.
4. **Native adapter:** preserve handler user/context, require a matching current server user context with existing view_operations capability, and use only authenticated server actor data. Tool arguments cannot choose actor, organization, callerKind, verdictAuthority, status or publication. Outer token/grant/revocation governance remains authoritative; do not introduce a session forgery or broader fallback.
5. Run related red/green suites, both web typecheck programs, style-drift and design-grounding guards, derived artifact checks and exact-head governed local-CI. Then independent review and protected DCO PR/merge, canonical upgrade, native capture/readback and owner portal draft inspection. Fixture entries remain labelled drafts; never promote them to calibration. Record genuine denial and failures; no unrun check passes.

These phases are internal sequencing of one capture boundary. Extracted services alone deliver no user outcome, so the repair is atomic. Engagement CE-EB8821DD grant intersection, review capacity and preview clone latency remain their existing owners' separate work; this fix does not claim to resolve them.

## Acceptance and verification references

- **AC-1:** With no browser session, an admitted MCP caller writes one organization-scoped draft critique through the existing revision path and provenance names its authenticated human/agent correctly.
- **AC-2:** Missing/revoked token scope, coworker grant, user capability or caller identity refuses before persistence; caller cannot select another actor/org or author a founder/designer verdict, publish or edit kernel content.
- **AC-3:** Browser capture and screenshot anchoring retain existing behavior; ordinary wiki editing/publishing authority and agent-proposed calibration exclusion remain unchanged.
- **AC-4:** Red/green boundary tests, affected typechecks, governed exact-head gate, protected DCO delivery and native served MCP draft/readback plus authorized owner portal review demonstrate the fix. Unrun/inconclusive proof remains explicit.

Traceability: requirement BI-A615654F/AC-1; flow MCP-to-draft; contract server-actor-and-agent-proposed-draft; verification no-cookie-save-readback-and-denial-controls. AC-2 permission-removal cases must be exercised through the governed executor in the shared runtime, not inferred from a direct handler test.

## Risk, compatibility and rollback

Actor confusion is the primary risk: the public browser action must never gain a client-supplied actor parameter. Shared-writer extraction must preserve cross-org/kernel rejection and published-page side effects; existing wiki tests remain regression controls. No migration or stored-data correction. One clean revert restores the former source behavior without changing stored critique data. Missing funding allocation is not inferred from administrator authority; no provider-spend or budget decision is made by this source repair.

## Backlog coverage

Atomic receipt cmvuexz0m3z8401o2ymry1ws4 binds initial ordered design e96fa07ff8345ee092f41998c833936ed945364c / blob727ba8e40c2844701d45b18b545cebbc14e80083. Research receipt initiative-c3fe8c19-c21b-457f-9363-91af611ec6a9; implementation admission IRD-F17522C9480D allowed.

Source checkpoint: the no-cookie integration regression failed twice before repair, including the exact capture_rejected/Unauthorized response. Shared server-only extraction plus native actor handoff made all64 tests in the five focused files pass; both web TypeScript programs passed. These use storage/framework fixtures while exercising the actual capture and overlay-save logic; they do not prove native transport, revoked live grants, deployed bytes or real persistence. Shared-runtime gate, independent review and served native saved-draft/readback remain unrun.
