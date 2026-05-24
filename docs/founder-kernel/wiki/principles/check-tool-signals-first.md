---
title: Check tool signals first
slug: check-tool-signals-first
pageKind: principle
status: published
abstract: When a tool call goes wrong, the first suspect is the tool's return value — not the model. Read the actual response shape before blaming the agent.
principleTier: core
principleDirection: Inspect tool return values, error codes, and structured payloads as the first hypothesis when downstream behavior is wrong, before blaming the calling model.
principleDimensionVector: {"evidence_density": 0.9, "speed_to_value": 0.6, "schema_grounding": 0.7, "human_cognitive_load": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: ai-coworker-universal
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Check tool signals first

**When a tool call returns an error or unexpected result, the first
suspect is the tool's return value, not the model that called it.**
Read the actual response shape — the error code, message, structured
data — before concluding "the agent hallucinated" or "the model is
broken."

## Why this exists

A recurring failure pattern: a tool returns a structured error (HTTP
503, a `{ ok: false, error: "..." }` payload, an exception class), the
agent's downstream behavior is wrong, and the operator concludes "the
model is making things up." Usually the model is responding correctly
to the actual signal it received. The tool's failure was either:

- A real upstream issue (sidecar down, API rate-limited, schema
  mismatch)
- A bug in the tool wrapper that surfaces a misleading shape (e.g.
  silent-success returning `ok:true, prUrl:null` when the underlying
  GitHub call failed)
- A configuration issue (provider unconfigured, credential expired)

Blaming the model wastes time and misses the actual fix.

## What to do instead

1. **Print the raw tool response** before interpreting it. If you have
   logs, grep for the tool name + recent timestamps and read the actual
   bytes that came back.
2. **Look for silent-failure shapes.** A tool that returns
   `{ ok: true, result: null }` when the underlying operation failed
   is lying. Patch the tool's contract to fail loud per the
   `silent-failure-hunter` pattern: structured error class, non-zero
   exit, observable diagnostic.
3. **Distinguish "tool said X" from "tool result implied X."** "The
   tool returned HTTP 503 with body `{error: "sidecar unreachable"}`"
   is a tool signal. "The tool didn't work" is interpretation.
4. **When the boundary is opaque** (a child process, a CLI adapter, a
   shell command), tee its stderr to a log file or capture it via
   structured trace lines like `[tool-trace] ok ...` /
   `[tool-trace] failed: ...` so future runs have the evidence the
   first run lacked.

## Anti-pattern

"The model didn't understand what I asked." Almost always wrong. The
model understood; the tool's response was either incomplete, silently
failed, or returned something the model correctly responded to.

## Related principles

- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — confirm
  the cause before naming it
- [`fail-fast-explain-clearly`](fail-fast-explain-clearly.md) — tools
  must fail loud with a structured signal
- [`never-fabricate`](never-fabricate.md) — read the response, don't
  invent it
