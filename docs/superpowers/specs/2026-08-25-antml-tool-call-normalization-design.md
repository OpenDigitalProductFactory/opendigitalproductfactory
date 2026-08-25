# Anthropic-style textual tool-call normalization design

**Backlog item:** BI-B87D7A69  
**Workroom:** WC-B97E2869  
**Status:** Design candidate

## Problem

The runtime has two overlapping textual tool-call extractors. The shared
cross-adapter extractor handles CLI-style `tool_use` JSON, while the chat-only
helper handles JSON `<tool_call>` and the Gemma/Llama template variant. The
shared extractor also accepts a fenced or inline JSON object whose first key is
`name` or `tool`; explanatory prose can therefore be mistaken for an action.
A governed Qwen3.8 27B run emitted this provider prompt format as ordinary text:

```text
<antml:invoke name="read_source_at_version">
<antml:parameter name="path" string="true">docs/superpowers/specs/...</antml:parameter>
<antml:parameter name="version" string="true">4bfdf154...</antml:parameter>
</antml:invoke>
```

The adapter did not recognize the complete block, so the agentic loop saw zero
authoritative tools and rejected the turn. The tool was correctly attached and
the model was eligible; the lost translation was at the textual-response edge.

## Objective manifest

**OBJ-ANTML-RECOVERY:** Normalize the observed complete `antml:invoke` response
into the existing internal tool-call contract so the normal governed execution
path can authorize and execute it.

**OBJ-FAIL-CLOSED:** Treat incomplete, malformed, ambiguous, or unsupported
markup as text, never as an executable tool call.

**OBJ-CANONICAL-PATH:** Consolidate textual normalization in the existing shared
cross-adapter extractor, then reuse the internal tool-call shape, agentic-loop
availability check, grants, argument validation, authority gate, and
`ToolExecution` audit. Add no parallel parser, executor, or approval path.

**OBJ-SCOPE:** Change only textual response normalization and its focused tests.
Do not alter model floors, assignments, prompts, grants, writer authority,
subject binding, or reviewer policy.

## Existing substrate

- `apps/web/lib/routing/extract-tool-calls.ts::extractToolCalls` is already the
  shared textual-response normalizer for Codex CLI, Claude CLI, chat fallback,
  and the agentic loop.
- `apps/web/lib/inference/ai-inference.ts::extractTextualToolCalls` is an older
  chat-only duplicate for JSON `<tool_call>` and Gemma/Llama markers. The repair
  removes this duplicate after moving those recognized formats to the shared
  extractor.
- `apps/web/lib/tak/agentic-loop.ts` resolves each normalized name against the
  attached tool definitions before calling `governedExecuteTool`; an unknown
  name is rejected as unavailable.
- The structured-tool-calling design at
  `docs/superpowers/specs/2026-03-18-structured-tool-calling-design.md` owns the
  provider-neutral internal call/result contract. This repair extends its edge
  normalization rather than introducing a second protocol.

No schema, migration, route, UI, model-profile, or deployment change is needed.

## Research and benchmarking

Anthropic's current tool documentation says user-defined tool names follow
`^[a-zA-Z0-9_-]{1,64}$`, inputs are defined by JSON Schema, and the model-facing
formatting instructions may be parsed with regular expressions and are not
guaranteed to be valid XML. DPF therefore adopts the documented name constraint
and scalar-versus-JSON parameter distinction, but does not treat arbitrary XML
as executable. Source:
<https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools>.

The W3C XML 1.0 recommendation defines proper nesting and the five predefined
entities (`amp`, `lt`, `gt`, `apos`, `quot`). DPF adopts those entity meanings
for parameter text and rejects unknown or unterminated entity references. It
does not add DTD, external-entity, namespace, or general XML processing. Source:
<https://www.w3.org/TR/xml/>.

The existing DPF adapters are the local benchmark: they already converge
provider-native calls on the same internal shape. The new branch must preserve
those structured paths while consolidating every textual format at one shared,
strict boundary.

## Architecture decision

WWMD DecisionInteraction **DI-2A4178058018** compared a chat-only patch,
consolidation in the shared extractor, and a new parser module. It selected
`consolidate-shared-extractor` with high confidence (composite 7.262, margin
1.139), `autonomyEligible=true`, and no commandment conflict. The decision
avoids a second parser while bounding the larger cross-adapter blast radius with
one compatibility matrix.

## Design

### Narrow grammar

Make `routing/extract-tool-calls.ts` the sole textual parser and add one pure
`antml` branch there:

1. Recognize only a complete `<antml:invoke ...>...</antml:invoke>` block.
2. Require exactly one valid `name` attribute and only supported optional call
   identity metadata.
3. Require the body to contain only whitespace and complete
   `<antml:parameter ...>...</antml:parameter>` elements.
4. Require exactly one `name` attribute per parameter; reject duplicate
   parameter names and unknown attributes.
5. Interpret `string="true"` content as decoded text. Otherwise parse the
   decoded, trimmed content as JSON so booleans, numbers, null, arrays, and
   objects keep their types. A parse failure rejects the whole invocation.
6. Decode only the five predefined XML entities and numeric character
   references. Reject unknown, malformed, or unterminated references.
7. Remove only successfully normalized blocks from `cleanText`. Invalid or
   truncated markup remains visible text and produces no call.

The shared parser keeps only explicit invocation envelopes:

- complete `<tool_use>...</tool_use>` and `<tool_call>...</tool_call>` wrappers;
- complete Gemma/Llama `<|tool_call>...<tool_call|>` markers;
- complete `<antml:invoke>...</antml:invoke>` blocks; and
- inline JSON carrying `type:"tool_use"`, or an explicitly `tool_use`-labelled
  fence.

A plain or `json`-labelled fenced object with only `name`/`tool` is explanatory
text, not an invocation. Removing that ambiguous acceptance is part of the
fail-closed contract, not a prompt workaround.

The extractor produces the existing `{ id, name, arguments }` shape. A missing
provider call ID receives a deterministic per-response ordinal ID; it grants no
authority and is used only to correlate a result inside the turn.

### Activation and authority

`chat-adapter.ts` calls the shared normalizer for non-structured text and uses
its `cleanText`; CLI and agentic-loop callers retain the array-only compatibility
entry point over the same implementation. Parsing does not execute a call. The
agentic loop still must find the name in the attached surface, then pass the
arguments through the canonical schema, grant, subject, sensitivity, approval,
and audit gates. Syntactically valid but unattached names remain non-executable.

### Complexity and scale ceiling

The parser scans one already-bounded model response and has linear work in the
response length plus decoded parameter length. It creates no persistent state
and performs no inventory query or cross-install fan-out. The current inference
response/token ceiling is the scale ceiling; EP-56AE0F69 owns broader cycle-3
agent-host reliability rather than this adapter repair.

## Acceptance contract

| Ref | Required evidence |
| --- | --- |
| **AC-OBSERVED-FORM** | The exact observed `read_source_at_version` block normalizes to one call with exact `path` and `version`. |
| **AC-TYPED-PARAMS** | String, escaped text, boolean, number, null, array, and object parameter cases preserve their intended values. |
| **AC-FAIL-CLOSED** | Truncated blocks, malformed nesting/attributes/entities/JSON, duplicate parameters, stray markup, and bare/fenced explanatory JSON without an explicit invocation envelope produce no call and remain text. |
| **AC-CANONICAL-AUTHORITY** | Existing OpenAI, Anthropic, JSON `<tool_call>`, and Gemma/Llama tests remain green; unknown/unattached names cannot pass the agentic-loop availability gate. |
| **AC-LIVE-REVIEWER** | A governed full-clone preview proves the immutable BI-9DC21917 reader and writer execute through normal authority and persist the required receipt/baseline. Prose is not evidence. |

## Risks and rollback

- **False-positive execution:** constrained by the complete-block grammar,
  strict attributes, typed parameter parsing, and unchanged downstream tool
  availability/authority checks.
- **Parser divergence:** constrained by keeping the logic inside the existing
  textual normalizer and returning its existing shape.
- **Provider-format drift:** fails closed as visible text; a new observed shape
  requires a new regression fixture.

Rollback is a normal revert of the parser and marker-detection commit. No data
or runtime migration is involved.
