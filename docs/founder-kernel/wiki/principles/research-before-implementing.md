---
title: Research before implementing
slug: research-before-implementing
pageKind: principle
tier: core
appliesTo: [agentic-coworker, claude-code, agent]
publicOnly: false
status: published
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Research before implementing

**Before writing code that depends on an external API, library, or
service, read its actual source or current documentation. Do not guess
at API shapes, default ports, env-var conventions, or response
contracts.**

This is the implementation-time counterpart to
[`research-and-use-standards`](research-and-use-standards.md). Where
that principle governs design-time choices ("use the standard"), this
one governs implementation-time verification ("verify how the standard
actually works in this version, on this platform, today").

## Why this exists

Concrete failures that named this principle:

- **STT sidecar port mismatch**: assumed `dpf-stt:8000` based on the
  prior speaches image; the chosen replacement (hwdsl2/whisper-server)
  listens on `9000`. Three places — healthcheck, host port mapping,
  provider `baseUrl` — were all wrong until a 30-second source read
  would have surfaced it.
- **`local`/`ollama` providers lack `endpointType`** in
  `providers-registry.json`. Code assumed the field was present; on a
  fresh install the schema default applied AFTER insert, but the
  predicate read the JSON value BEFORE insert and got `undefined`.
  Reading the seed file beforehand would have caught the omission.
- **Prisma `BackupRestore` audit row was being wiped by its own
  restore** because pg_restore drops + recreates the table. Five
  minutes of reading what `--clean` actually does would have flagged
  the architecture issue before the PR was even drafted.

## What to do instead

Before writing the integration:

1. **Read the upstream README and recent release notes.** Image tags
   move; APIs change between major versions; defaults vary by build.
2. **Inspect the actual source** when the upstream README is thin.
   Container images publish their entrypoint and config schema; npm
   packages publish type definitions; HTTP services publish OpenAPI
   manifests. Read them, don't assume from a prior project's pattern.
3. **Test the boundary in isolation before wrapping it.** Pull the
   image, hit the API with curl, observe the actual shape. Wrapping
   an integration around an unverified contract is the most common
   path to silent failures downstream.
4. **Verify the schema field you're predicating on is actually
   present** in the data — not just declared in the type. JSON catalog
   entries that omit optional fields make TypeScript-level checks fire
   on `undefined`, which then matches the wrong predicate branch.

## Anti-pattern

"It's probably the same as the last one." Library APIs, container
ports, environment-variable names, and default models all drift between
versions. The 30 seconds to read the current source is always cheaper
than the hour to debug an integration that "should have worked."

## Related principles

- [`research-and-use-standards`](research-and-use-standards.md) — design
  time: pick the standard
- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — read the
  actual state before naming a cause
- [`check-tool-signals-first`](check-tool-signals-first.md) — read the
  actual response before interpreting
