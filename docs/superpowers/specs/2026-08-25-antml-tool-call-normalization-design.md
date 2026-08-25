# Anthropic-style textual tool-call normalization design

**Backlog item:** BI-B87D7A69  
**Workroom:** WC-B97E2869  
**Status:** Design candidate

## Problem

The canonical chat adapter already normalizes provider-native Anthropic
`tool_use` blocks, OpenAI `tool_calls`, JSON `<tool_call>` blocks, and the
Gemma/Llama template variant into one internal tool-call shape. A governed
Qwen3.8 27B run instead emitted this provider prompt format as ordinary text:

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

**OBJ-CANONICAL-PATH:** Reuse the chat adapter, internal tool-call shape,
agentic-loop availability check, grants, argument validation, authority gate,
and `ToolExecution` audit. Add no parallel executor or approval path.

**OBJ-SCOPE:** Change only textual response normalization and its focused tests.
Do not alter model floors, assignments, prompts, grants, writer authority,
subject binding, or reviewer policy.

## Existing substrate

- `apps/web/lib/inference/ai-inference.ts::extractTextualToolCalls` is the
  canonical textual-response normalizer.
- `apps/web/lib/routing/chat-adapter.ts` invokes that normalizer when a local or
  OpenAI-compatible response leaks textual tool markers.
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

The existing DPF normalizer is the local benchmark: it already converts the two
other textual formats into the same internal shape. The new branch must preserve
those tests and route the third observed format through the same downstream
authorization boundary.

## Design

### Narrow grammar

Add one pure `antml` extraction branch to `extractTextualToolCalls`:

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

The extractor produces the existing `{ id, name, arguments }` shape. A missing
provider call ID receives a deterministic per-response ordinal ID; it grants no
authority and is used only to correlate a result inside the turn.

### Activation and authority

`chat-adapter.ts` adds `<antml:invoke` to the existing textual-marker detection.
It does not execute a call. The agentic loop still must find the name in the
attached surface, then pass the arguments through the canonical schema, grant,
subject, sensitivity, approval, and audit gates. Syntactically valid but
unattached names remain non-executable.

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
| **AC-FAIL-CLOSED** | Truncated blocks, malformed nesting/attributes/entities/JSON, duplicate parameters, and stray markup produce no call and remain text. |
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
