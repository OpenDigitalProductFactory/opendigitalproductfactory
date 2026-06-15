// MCP wire-argument coercion (BI-16A80690).
//
// Some MCP clients — and some JSON-RPC bridges — serialize structured tool
// arguments as JSON *strings* instead of native JSON values. This shows up two
// ways on the wire:
//
//   mode 1 — the whole `arguments` object arrives as a string:
//     "{\"callingPopulation\":\"external_coding_agent\",\"options\":[...]}"
//     -> every field reads back `undefined` -> "Invalid callingPopulation".
//
//   mode 2 — an individual array/object-typed arg arrives as a string:
//     { callingPopulation: "external_coding_agent",
//       options: "[{\"id\":\"a\",\"description\":\"A\"}]" }
//     -> Array.isArray(options) === false -> "Empty options".
//
// Both make a perfectly valid call fail strict validation in the handler. We
// re-hydrate those values once, before the tool switch, so every handler sees
// native JSON regardless of how the client framed it.
//
// The coercion is driven by each tool's declared `inputSchema` so it is
// precise: only params the schema types as `array`/`object` are JSON.parsed.
// A string-typed param (e.g. a file's literal JSON `content`, a free-text
// `description` that happens to start with `{`) is never touched, so
// content-bearing tools keep their exact payloads — a blanket
// "parse anything that looks like JSON" would corrupt them.
//
// Precedent: mcp-tools.ts already does the `typeof x === "string" ? JSON.parse(x) : x`
// dance ad hoc in a few handlers; this centralizes it for every tool, and
// sits alongside sanitizeToolParams() as the other schema-driven param
// normalizer that runs before the switch.

/** Guards against pathological / self-referential schemas. Real tool schemas
 *  here are shallow (options -> items -> features), so 6 is generous. */
const MAX_DEPTH = 6;

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  additionalProperties?: unknown;
};

function asSchemaNode(value: unknown): JsonSchemaNode | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchemaNode)
    : null;
}

function schemaDeclaresStructured(schema: JsonSchemaNode): boolean {
  const t = schema.type;
  if (Array.isArray(t)) return t.includes("array") || t.includes("object");
  return t === "array" || t === "object";
}

function tryParseJson(
  value: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

/** Coerce a single value against its schema node, recursing into array items
 *  and object properties so nested stringification (e.g. a per-option
 *  `features` map sent as a string) is also re-hydrated. Pure — never mutates
 *  the input; returns new arrays/objects where it changes anything. */
function coerceValue(
  value: unknown,
  schema: JsonSchemaNode | null,
  depth: number,
): unknown {
  if (schema === null || depth > MAX_DEPTH) return value;

  let current = value;

  // Re-hydrate a stringified array/object whose schema says it should be
  // structured. If it does not parse, leave the original string in place so
  // the handler's own strict check emits a clear "must be an array" error
  // rather than us masking genuinely malformed input.
  if (typeof current === "string" && schemaDeclaresStructured(schema)) {
    const parsed = tryParseJson(current);
    if (parsed.ok) current = parsed.value;
  }

  if (Array.isArray(current)) {
    const itemSchema = asSchemaNode(schema.items);
    if (!itemSchema) return current;
    return current.map((item) => coerceValue(item, itemSchema, depth + 1));
  }

  if (current && typeof current === "object") {
    const props = schema.properties;
    if (!props || typeof props !== "object") return current;
    const out: Record<string, unknown> = {
      ...(current as Record<string, unknown>),
    };
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in out) {
        out[key] = coerceValue(out[key], asSchemaNode(propSchema), depth + 1);
      }
    }
    return out;
  }

  return current;
}

/**
 * Normalize tool arguments that a client may have serialized as JSON strings.
 *
 * @param rawParams   The `arguments` payload as received from the transport.
 *                    May itself be a JSON string (mode 1).
 * @param inputSchema The tool's declared JSON Schema. When omitted, only the
 *                    whole-object-string case is handled and individual fields
 *                    are passed through untouched (no schema => no safe way to
 *                    know which strings are meant to be structured).
 * @returns A plain object suitable for the tool handler. Returns `{}` when the
 *          payload cannot be resolved to an object, so the handler's own
 *          "missing required field" checks fire with a clear message.
 */
export function coerceMcpToolArgs(
  rawParams: unknown,
  inputSchema?: Record<string, unknown> | null,
): Record<string, unknown> {
  let top: unknown = rawParams;

  // mode 1: the entire arguments object arrived as a JSON string.
  if (typeof top === "string") {
    const parsed = tryParseJson(top);
    if (parsed.ok) top = parsed.value;
  }

  // Tool arguments are always a JSON object. Anything else (a bare string that
  // did not parse, a number, an array, null/undefined) cannot be indexed by a
  // handler — hand back {} and let the strict checks report the real problem.
  if (!top || typeof top !== "object" || Array.isArray(top)) {
    return {};
  }

  const schema = asSchemaNode(inputSchema);
  if (!schema) return top as Record<string, unknown>;

  // mode 2: individual array/object args arrived as JSON strings. Coerce per
  // the declared schema.
  const coerced = coerceValue(top, schema, 0);
  return coerced && typeof coerced === "object" && !Array.isArray(coerced)
    ? (coerced as Record<string, unknown>)
    : (top as Record<string, unknown>);
}
