---
status: draft
---

# Readable managed hook purposes

BI-26DC98EE; WC-4D594E6F. Small defect repair extending FLOW-MCP-HOOK in
[the client contract design](2026-09-04-mcp-client-contract-consolidation-design.md#5-discovery-and-operator-presentation--existing-bi-1ba8f46c).

## Defect and boundary

The installed plugin and canonical `packages/dpf-skill-pack/hooks/hooks.json`
contain 28 handlers with commands but no human-readable purpose. The operator
sees numbered hooks when deciding what to trust. The plugin owns its metadata;
the client owns how approval rows render and which exact definitions are trusted.
The peer-owned exposure initiative BI-1BA8F46C remains unchanged.

## Design

Add the documented `statusMessage` to each canonical handler. Write its purpose
once, beside the command. Preserve commands, matchers, handler order and events.
Generate `packages/dpf-skill-pack/hooks/README.md` from those definitions, with
event, event-local ordinal, matcher, purpose and a relative source link. This
replaces a hand-maintained external mapping with a reference shipped in the pack.
The ordinal is a lookup aid, not a stable ID; identify a hook by event and command.

The generator must reject a missing purpose or an unsafe/unresolvable source
link. Its check mode detects stale documentation without rewriting files. Use
Node built-ins and the existing JSON definition; no service, database table,
dependency, new execution wrapper or second hook catalog is needed. Adapter
tests must prove metadata survives existing transformations. Trust decisions
remain in the client and are never represented as static generated facts.

No schema migration or policy change. Existing clients may ignore presentation
metadata. Do not add undocumented `name`, `title`, or per-handler `description`
fields. A new definition may require fresh client trust; do not approve it on
the operator's behalf. Do not label an execution message as an approval label.

## Research and settled direction

[Codex hooks](https://learn.chatgpt.com/docs/hooks) documents per-handler
`statusMessage` as execution feedback and top-level file `description`. It does
not promise friendly approval-row names. The existing client-contract design
already compares Codex and Claude hook adapters and chooses this supported
field plus a generated reference when a host cannot render friendly row labels.
Reuse that direction. A hand-maintained second list or invented UI field would
reintroduce drift. This bounded metadata repair requires no new architecture.

## Ordered fix plan

1. Add an invariant test that all current handlers expose a useful purpose and
   that the generated reference covers every handler and source link.
2. Add purpose metadata, derive the reference, and test escaping and stale-output
   detection. Compare all original operational fields before and after.
3. Verify the existing surface adapters preserve metadata; run the affected
   built-in Node tests and source guards. Commit with DCO and publish through PR.
4. Refresh the installed pack through its managed update path after merge.
   Verify installed metadata and inspect what the supported clients display.
   If approval rows remain numbered or cannot be inspected, record that exact
   limitation and expose the shipped reference before trust. Never claim rendered
   acceptance from JSON alone.

## Acceptance

- AC-HOOK-1: Every canonical handler has an accurate concise purpose.
- AC-HOOK-2: The generated reference includes every event, matcher, command and
  relative source link; missing metadata and stale output fail verification.
- AC-HOOK-3: Original commands, event order and matchers remain identical; the
  existing adapter outputs retain supported purpose metadata.
- AC-HOOK-4: The managed install carries the metadata and reference. Record the
  actual host/version and approval-display result separately from execution text;
  an unavailable display check remains unverified.

Approximately one fifth of effort consolidates the inventory into the canonical
definition and generator, removing hand-maintained purpose drift. Documentation
and tests ship together. No performance or approval-UI improvement is claimed
until observed.
