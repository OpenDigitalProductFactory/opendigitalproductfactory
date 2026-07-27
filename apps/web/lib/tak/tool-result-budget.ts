import {
  maskForContext,
  type ContextMaskAuthority,
} from "@/lib/govern/data/mask-for-context";

/**
 * Tool-result token-budget guard.
 *
 * Design criterion P6 / gap G1 from
 * `docs/architecture/context-engineering-standards.md`: a single tool result
 * must never blow the model's context window. This is *existential* on the
 * local-first path — the served local build window is ~24,576 tokens
 * (`RECOMMENDED_BUILD_CONTEXT_TOKENS`), so one unbounded result can evict the
 * execution plan, the profession corpus, or the build instructions and stall
 * the agent.
 *
 * We cap the MODEL-FACING serialization only. The stored `ToolResult` used for
 * audit, receipts, and governance stays whole (see `mcp-governed-execute.ts`) —
 * truncation is a context-economy concern, not a data-integrity one. Whenever
 * we cut, we emit an explicit NOTICE so the model knows to paginate/filter and
 * call again rather than assume it received the entire payload (silent
 * truncation makes the model reason over data it never saw).
 *
 * Two callers, two cap regimes:
 *  - the native agentic loop, which KNOWS its (often small, local) window and
 *    passes `maxContextTokens` for a window-proportional cap;
 *  - the external MCP route (`/api/mcp/v1`), which serves big-window external
 *    CLIs (Claude Code ~200K, Grok ~2M) and uses a generous fixed cap matching
 *    Claude Code's own ~25K-token tool-result ceiling.
 */

// ~1K tokens (chars ≈ tokens * 4). Conservative default when the window is
// unknown (e.g. the first local dispatch, before `resolvedMaxContextTokens` is
// learned). Roughly preserves the prior inline `JSON.stringify(data).slice(0,
// 3000)` while also bounding `message` and adding a truncation notice.
export const DEFAULT_TOOL_RESULT_CHAR_CAP = 4_000;

// ~25K tokens. Matches Claude Code's default tool-result cap; used for
// big-window external CLIs on the MCP route, where over-aggressive truncation
// would harm legitimate large reads but an *unbounded* dump (today's behaviour)
// is a real context tax.
export const MCP_ROUTE_TOOL_RESULT_CHAR_CAP = 100_000;

// Share of a known window a single fresh tool result may occupy. 10% leaves
// headroom for the system prompt, plan reminder, corpus, and history.
const WINDOW_RESULT_SHARE = 0.1;
const CHARS_PER_TOKEN = 4;

/**
 * Resolve the per-result character cap from the (possibly unknown) model
 * window. Window-proportional, floored at the conservative default and ceiled
 * at the big-window cap.
 */
export function resolveToolResultCharCap(maxContextTokens?: number | null): number {
  if (!maxContextTokens || maxContextTokens <= 0) return DEFAULT_TOOL_RESULT_CHAR_CAP;
  const windowChars = maxContextTokens * CHARS_PER_TOKEN;
  const share = Math.floor(windowChars * WINDOW_RESULT_SHARE);
  return Math.max(DEFAULT_TOOL_RESULT_CHAR_CAP, Math.min(share, MCP_ROUTE_TOOL_RESULT_CHAR_CAP));
}

export type ModelFacingToolResult = {
  success: boolean;
  message?: string | null;
  error?: string | null;
  data?: unknown;
};

export type ClampedToolResult = {
  /** The model-facing string, guaranteed `<= maxChars`. */
  text: string;
  truncated: boolean;
  /** Length of the untruncated serialization (for telemetry). */
  originalChars: number;
  /** Opaque only; raw token maps never leave the controlled runtime. */
  rehydrationHandle?: string;
};

function buildFullText(result: ModelFacingToolResult): string {
  if (!result.success) {
    const err = result.error ?? result.message ?? "unknown error";
    return `Error: ${err}`;
  }
  const message = (result.message ?? "").toString();
  if (result.data === undefined || result.data === null) return message;
  let dataJson: string;
  try {
    dataJson = JSON.stringify(result.data);
  } catch {
    dataJson = "[unserializable data]";
  }
  return message ? `${message}\n${dataJson}` : dataJson;
}

/**
 * Produce the model-facing string for a tool result, truncated to `maxChars`
 * with an explicit notice. The notice counts against the budget, so the
 * returned `text` never exceeds `maxChars`.
 */
export function clampToolResultForModel(
  result: ModelFacingToolResult,
  opts?: { maxChars?: number; contextMask?: ContextMaskAuthority },
): ClampedToolResult {
  const maxChars = Math.max(0, opts?.maxChars ?? DEFAULT_TOOL_RESULT_CHAR_CAP);
  const masked = opts?.contextMask ? maskForContext(result, opts.contextMask) : null;
  const full = buildFullText(masked?.value ?? result);
  const handle = masked?.rehydrationHandle;
  if (full.length <= maxChars) {
    return {
      text: full,
      truncated: false,
      originalChars: full.length,
      ...(handle ? { rehydrationHandle: handle } : {}),
    };
  }
  const notice =
    `\n…[truncated ${full.length - maxChars} of ${full.length} chars — result exceeds the per-call ` +
    `context budget; narrow it with filter/pagination/range parameters and call again]`;
  const keep = Math.max(0, maxChars - notice.length);
  return {
    text: full.slice(0, keep) + notice,
    truncated: true,
    originalChars: full.length,
    ...(handle ? { rehydrationHandle: handle } : {}),
  };
}
