// Schema/handler parity for the workroom scope block.
//
// `parseScopeInput` picks scope fields off the MCP params ONE BY ONE. That is
// safe against unknown input and unsafe against its own drift: a field added to
// the tool schema and to the scope normalizer, but not to that pick list, is
// accepted from the caller, silently dropped, and answered `success: true`.
//
// This is not hypothetical. `backlogItemId` had exactly this defect on
// `adopt_worktree` (PR #4837), and `workShape` reproduced it on
// `create_workroom` immediately after shipping — the schema advertised it, the
// normalizer validated it, the store persisted it, and the handler in between
// dropped it. A room was convened that reported success and could never wake.
//
// So the guard is structural rather than one more per-field test: every key the
// schema advertises must be carried, and the failure names the missing key.

import { describe, expect, it } from "vitest";

import { workCapsulesPack } from "@/lib/mcp/packs/work-capsules-pack";
import { normalizeWorkCapsuleScopeInput } from "@/lib/work-capsules";
import { __testing__ } from "./mcp-handlers";

/** Scope keys the create_workroom tool schema advertises to callers. */
function advertisedScopeKeys(): string[] {
  const tool = workCapsulesPack.definitions.find((entry) => entry.name === "create_workroom");
  if (!tool) throw new Error("create_workroom is not in the pack");
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  const properties = Object.keys(schema.properties ?? {});
  // Non-scope fields on the same schema; everything else is scope.
  const notScope = new Set([
    "title",
    "objective",
    "source",
    "idempotencyKey",
    "executorKind",
    "repositoryFullName",
  ]);
  return properties.filter((key) => !notScope.has(key));
}

describe("the scope block the schema advertises is the scope block the handler carries", () => {
  it("carries every advertised scope key through parseScopeInput", () => {
    const keys = advertisedScopeKeys();
    expect(keys.length).toBeGreaterThan(0);

    // A sentinel per key: if the handler drops one, its sentinel goes missing.
    const params: Record<string, unknown> = {};
    for (const key of keys) params[key] = `__sentinel_${key}__`;

    const parsed = __testing__.parseScopeInput(params) as Record<string, unknown>;
    const dropped = keys.filter((key) => parsed[key] !== `__sentinel_${key}__`);
    expect(
      dropped,
      `parseScopeInput drops scope key(s) the create_workroom schema advertises: ${dropped.join(", ")}`,
    ).toEqual([]);
  });

  it("carries every scope key the normalizer understands", () => {
    // The other half of the seam: a field the normalizer validates but the
    // schema never advertises is unreachable, and one the handler never passes
    // is inert. Both directions have to hold for the contract to mean anything.
    const normalized = normalizeWorkCapsuleScopeInput();
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(normalized)) params[key] = `__sentinel_${key}__`;

    const parsed = __testing__.parseScopeInput(params) as Record<string, unknown>;
    const dropped = Object.keys(normalized).filter(
      (key) => parsed[key] !== `__sentinel_${key}__`,
    );
    expect(
      dropped,
      `parseScopeInput drops scope key(s) the normalizer understands: ${dropped.join(", ")}`,
    ).toEqual([]);
  });

  it("carries workShape specifically — the field that shipped broken", () => {
    const parsed = __testing__.parseScopeInput({
      workShape: "dependency-advisory-watch@1.0.0",
    }) as Record<string, unknown>;
    expect(parsed.workShape).toBe("dependency-advisory-watch@1.0.0");
    expect(normalizeWorkCapsuleScopeInput(parsed).workShape).toBe(
      "dependency-advisory-watch@1.0.0",
    );
  });
});
