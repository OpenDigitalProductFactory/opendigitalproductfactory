import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hydrateS5JsiSelector,
  s5BrokerCallSchema,
  s5BrokerReceiptSchema,
  s5LaunchProjectionSchema,
  s5LaunchWireJsonSchema,
  s5ProviderPreflightSchema,
} from "./s5-launch";
import fixture from "./s5-launch.v1.coordination.fixture.json";
import published from "./s5-launch.v1.schema.json";

describe("S5 v1 structural compatibility (no live authority)", () => {
  it("keeps the consumer JSON Schema identical to the TypeScript source", () => {
    expect(published).toEqual(s5LaunchWireJsonSchema());
  });

  it("publishes the restricted coordination launch and only one identity subject", () => {
    const projection = s5LaunchProjectionSchema.parse(fixture.launch);
    expect(projection.mode).toBe("read-only-coordination");
    if (projection.mode !== "read-only-coordination") throw new Error("Expected coordination projection");
    expect(projection.permittedOperations).toEqual(["get_workroom", "read_room_messages", "post_room_message"]);
    expect(hydrateS5JsiSelector(projection)).toEqual({ ...fixture.launch.jsi.selector, subject: fixture.launch.subject });
    expect(s5LaunchProjectionSchema.safeParse({ ...projection, subject: undefined }).success).toBe(false);
    expect(s5LaunchProjectionSchema.safeParse({ ...projection, jsi: {
      ...projection.jsi, selector: { ...fixture.launch.jsi.selector, subject: fixture.launch.subject },
    } }).success).toBe(false);
  });

  it.each([
    { schemaVersion: "s5-launch.v2" },
    { permittedOperations: ["get_workroom", "edit_source", "run_test", "open_pr"] },
    { permittedOperations: ["get_workroom", "get_workroom"] },
    { worktreeRef: "worktree-not-for-coordination" },
    { roomCredential: "synthetic-credential-must-not-be-in-json" },
    { operationId: "room-operation:00000000-0000-4000-8000-000000000001" },
    { jsi: { kind: "not-applicable" } },
    { jsi: { kind: "required-unavailable" } },
    { budget: { ...fixture.launch.budget, maxInputTokens: 10_001 } },
    { budget: { ...fixture.launch.budget, maxOutputTokens: 1_201 } },
    { budget: { ...fixture.launch.budget, maxReasoningTokens: 1_201 } },
    { authority: { ...fixture.launch.authority, permitRef: "" } },
  ])("refuses an invalid coordination projection %j", (mutation) => {
    expect(s5LaunchProjectionSchema.safeParse({ ...fixture.launch, ...mutation }).success).toBe(false);
  });

  it("requires worktree binding for the separate coding mode", () => {
    const { coordination: _coordination, ...rest } = fixture.launch;
    const coding = { ...rest, mode: "bounded-coding", worktreeRef: "fixture-worktree", jsi: { kind: "not-applicable", activityKey: "code-fixture" } };
    expect(s5LaunchProjectionSchema.safeParse(coding).success).toBe(true);
    expect(s5LaunchProjectionSchema.safeParse({ ...coding, worktreeRef: undefined }).success).toBe(false);
    expect(s5LaunchProjectionSchema.safeParse({ ...coding, jsi: {
      kind: "not-applicable", activityKey: fixture.launch.jsi.selector.activityKey,
    } }).success).toBe(false);
  });

  it("rejects expiry outside the qualification window and selector substitution", () => {
    const launch = fixture.launch;
    expect(s5LaunchProjectionSchema.safeParse({ ...launch, expiresAt: launch.jsi.validUntil + 1 }).success).toBe(false);
    expect(s5LaunchProjectionSchema.safeParse({ ...launch, jsi: {
      ...launch.jsi, selector: { ...launch.jsi.selector, installationId: "other-install" },
    } }).success).toBe(false);
  });

  it("represents a case-bound no-wake proposal and opaque durable acknowledgement", () => {
    const call = s5BrokerCallSchema.parse(fixture.brokerCall);
    const receipt = s5BrokerReceiptSchema.parse(fixture.brokerReceipt);
    expect(receipt.operationId).toBe(call.operationId);
    expect(call.args.caseKey).toBe(fixture.launch.caseKey);
    expect(call.args.recipient).toEqual(fixture.launch.coordination.recipient);
    for (const mutation of [
      { addressedTo: ["coordinator"] }, { roleAlias: "accountable" }, { notify: false }, { wake: false },
      { body: "Please review this @recipient" },
      { recipient: "@example" }, { recipient: { ...call.args.recipient, destinationRef: "@example" } },
    ]) {
      expect(s5BrokerCallSchema.safeParse({ ...call, args: { ...call.args, ...mutation } }).success).toBe(false);
    }
    expect(s5BrokerCallSchema.safeParse({ ...call, operationId: "sha256:" + "a".repeat(64) }).success).toBe(false);
    expect(s5BrokerReceiptSchema.safeParse({ ...receipt, requestDigest: "sha256:" + "a".repeat(64) }).success).toBe(false);
  });

  it("accounts for the full serialized provider input before submission", () => {
    const preflight = s5ProviderPreflightSchema.parse(fixture.providerPreflight);
    const encoded = JSON.stringify(fixture.providerPayload);
    expect(preflight.input.totalBytes).toBe(Buffer.byteLength(encoded, "utf8"));
    // Only the synthetic fixture tokenizer counts one token per code point.
    expect(preflight.input.totalTokens).toBe([...encoded].length);
    for (const part of ["prompt", "projection", "roomContext", "toolSchemas"] as const) {
      expect(preflight.input.bytesByPart[part]).toBe(Buffer.byteLength(JSON.stringify(fixture.providerPayload[part]), "utf8"));
    }
    expect(preflight.input.totalBytes).toBe(Object.values(preflight.input.bytesByPart).reduce((sum, n) => sum + n, 0));
    for (const input of [
      { ...preflight.input, totalBytes: preflight.input.totalBytes - 1 },
      { ...preflight.input, totalTokens: preflight.appliedLimits.maxInputTokens + 1 },
      { ...preflight.input, tokenizerRef: "" },
      { ...preflight.input, bytesByPart: { ...preflight.input.bytesByPart, roomContext: undefined } },
    ]) {
      expect(s5ProviderPreflightSchema.safeParse({ ...preflight, input }).success).toBe(false);
    }
    expect(s5ProviderPreflightSchema.safeParse({ ...preflight, appliedLimits: {
      ...preflight.appliedLimits, maxReasoningTokens: preflight.appliedLimits.maxOutputTokens + 1,
    } }).success).toBe(false);
  });
});

describe("S5 hook ownership coverage (served proofs remain unrun)", () => {
  it("matches every manifest command, exact matcher and lifecycle event with multiplicity", () => {
    const root = new URL("../../../../", import.meta.url);
    const { hooks } = JSON.parse(readFileSync(new URL("packages/dpf-skill-pack/hooks/hooks.json", root), "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
    };
    const design = readFileSync(new URL("docs/superpowers/specs/2026-11-25-workroom-bound-toolset-design.md", root), "utf8");
    const table = design.split("## Hook ownership and hook-free proof\n")[1]!.split("\n## ")[0]!;
    const matchers: Record<string, [string, string]> = {
      "PreToolUse Bash": ["PreToolUse", "Bash"],
      "PreToolUse questions": ["PreToolUse", "AskUserQuestion|request_user_input|request_user_input_async"],
      "PreToolUse Write/Edit/MultiEdit": ["PreToolUse", "Write|Edit|MultiEdit"],
      "PostToolUse MCP claim/heartbeat operations": ["PostToolUse", "^mcp__.+__(adopt_worktree|heartbeat_workroom|claim_workroom_scope|claim_backlog_item_for_work|create_workroom)$"],
    };
    const rows = [...table.matchAll(/^\| ([^|]+) \| `([a-z-]+)([^`]*)` \| (Server|Kernel|Launcher) \| ([^|]+) \|$/gmu)];
    const owned = rows.map(([, row, script, args, , proof]) => {
      const [event, matcher] = matchers[row!] ?? [row!, ""];
      expect(proof!.trim()).not.toBe("");
      return JSON.stringify([event, matcher, "command", 'node "${CLAUDE_PLUGIN_ROOT}/hooks/' + script + '.mjs"' + args]);
    });
    const declared = Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap(({ matcher, hooks }) =>
      hooks.map(({ type, command }) => JSON.stringify([event, matcher ?? "", type, command]))));
    expect(owned).toHaveLength(35);
    expect(owned.sort()).toEqual(declared.sort());
  });
});
