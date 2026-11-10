---
status: active
---

# Restore the Workroom compatibility window

Backlog: BI-0702869B. Workroom: WC-F0AFD099. Shape: delivery-break-fix@1.0.0.

The existing rename contract keeps legacy names callable without advertising
duplicate tools. Live acceptance on c448b8f returns `unknown_tool` for
`list_work_capsules`, while `list_workrooms` enumerates all 504 rooms. The pack
retains aliases in handlers and grants, but governed execution searches only
advertised definitions. Handler-only tests missed the transport boundary.

Reuse that contract and the typed pagination design at
`docs/superpowers/specs/2026-09-07-typed-workroom-pagination-design.md`.
No new capability, schema, migration, grants or decision engine is needed.

1. Reproduce failure through governed execution and JSON-RPC transport tests.
2. Extract the existing alias map into a dependency-light shared module. Resolve
   names before transport scope/quiescence checks and governed execution, and
   use the same map for discovery. Preserve canonical policy and audit identity.
3. Verify capability and token-scope denials, unknown names, unadvertised aliases,
   discovery without grants, and complete canonical/legacy pagination.
4. Run affected tests, TypeScript checks and source guards, merge through the
   protected queue, publish the canonical image and verify both names live.

This is a compatibility repair under settled direction. A repeated design
approval would not answer a new decision. Existing token and user/agent authority
checks remain mandatory. Live acceptance is separate from source test evidence.
