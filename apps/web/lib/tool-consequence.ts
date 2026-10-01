// A tool's declared consequence, and the one supported way a single call may
// narrow it. Moved out of mcp-tools.ts (BI-2D65BD1B) so the declaration and its
// per-call narrowing live together; mcp-tools.ts re-exports the public names.

/**
 * Declared reach of a tool's effect. See `ToolDefinition.consequence`.
 * Closed set: a new axis is a deliberate widening of what the gate governs,
 * not a string literal someone invents at a call site.
 */
export type ToolConsequence = "outward" | "irreversible" | "authority";

/**
 * The closed set, as a runtime value. `deriveConsequentialToolNames`
 * (apps/web/lib/tak/consequential-tool-coverage.ts) derives the consult-gated
 * set from `sideEffect && consequence != null` — TAK §8.4.1, classification is
 * derived from a declared property, never re-enumerated in a second allowlist.
 */
export const TOOL_CONSEQUENCES: readonly ToolConsequence[] = [
  "outward",
  "irreversible",
  "authority",
] as const;

/** See `ToolDefinition.consequenceScope`. Closed set. */
export type ToolConsequenceScope = "business" | "platform";

/** What one call of a tool looks like to the code that classifies it. */
export type ToolCallConsequenceInput = {
  toolName: string;
  params: Record<string, unknown>;
  userId: string;
  context?: { agentId?: string; authSource?: string };
  now?: Date;
};

/**
 * The effect of ONE call. `consequence: null` says this call is ordinary even
 * though the tool can be consequential; `reason` is recorded on the decision.
 */
export type ToolCallConsequence = {
  consequence: ToolConsequence | null;
  reason: string;
};

/**
 * Narrows a tool's declared consequence for one call. It may only NARROW: the
 * resolver keeps the declaration for any answer other than null, and keeps it
 * when the refiner throws. The static declaration therefore still decides the
 * consult-gate floor, receipts and approval-card text; only whether this call
 * is damaging can change.
 */
export type ToolCallConsequenceRefiner = (call: ToolCallConsequenceInput) => Promise<ToolCallConsequence>;

export type ResolvedCallConsequence = {
  consequence: ToolConsequence | null;
  refinement: { declared: ToolConsequence; reason: string } | null;
};

/** Apply a tool's refiner under the narrow-only rule. Fails closed. */
export async function resolveCallConsequence(
  tool: { consequence?: ToolConsequence; consequenceForCall?: ToolCallConsequenceRefiner },
  call: ToolCallConsequenceInput,
): Promise<ResolvedCallConsequence> {
  const declared = tool.consequence ?? null;
  if (!declared || !tool.consequenceForCall) return { consequence: declared, refinement: null };
  try {
    const refined = await tool.consequenceForCall(call);
    return {
      consequence: refined.consequence === null ? null : declared,
      refinement: { declared, reason: refined.reason },
    };
  } catch {
    return { consequence: declared, refinement: { declared, reason: "refinement-unavailable" } };
  }
}
