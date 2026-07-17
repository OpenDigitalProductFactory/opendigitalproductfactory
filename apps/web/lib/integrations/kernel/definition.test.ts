import { describe, expect, expectTypeOf, it } from "vitest";

import {
  connectorDefinitionSchema,
  parseConnectorDefinition,
  type ConnectorDefinition,
} from "./definition";
import { ConnectorError, CONNECTOR_ERROR_KINDS } from "./error";

const validDefinition = {
  schemaVersion: 1,
  key: "postmark",
  displayName: "Postmark",
  capabilities: ["email.send", "email.delivery-status"],
  auth: { kind: "api-key" },
  callback: { kind: "webhook" },
  operations: [
    {
      id: "send-email",
      capability: "email.send",
      retry: { maxAttempts: 3, initialDelayMs: 250, maxDelayMs: 5_000 },
    },
  ],
  health: { probeIntervalSeconds: 60 },
  sync: { kind: "none" },
  authorities: [{ resource: "email.delivery-status", mode: "source" }],
} satisfies ConnectorDefinition;

describe("connectorDefinitionSchema", () => {
  it("accepts a declarative connector definition", () => {
    expect(connectorDefinitionSchema.parse(validDefinition)).toEqual(validDefinition);
  });

  it.each([0, -1, 1.5])("rejects invalid schema version %s", (schemaVersion) => {
    expect(
      connectorDefinitionSchema.safeParse({ ...validDefinition, schemaVersion }).success,
    ).toBe(false);
  });

  it.each([2, 999])("rejects unsupported positive schema version %s", (schemaVersion) => {
    expect(
      connectorDefinitionSchema.safeParse({ ...validDefinition, schemaVersion }).success,
    ).toBe(false);
  });

  it.each(["", " "])("rejects an empty connector key %#", (key) => {
    expect(connectorDefinitionSchema.safeParse({ ...validDefinition, key }).success).toBe(false);
  });

  it("requires unique nonempty operation IDs", () => {
    const duplicate = { ...validDefinition.operations[0] };
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        operations: [duplicate, duplicate],
      }).success,
    ).toBe(false);
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        operations: [{ ...duplicate, id: " " }],
      }).success,
    ).toBe(false);
  });

  it.each([
    "api-key",
    "oauth2-client-credentials",
    "oauth2-authorization-code",
    "none",
  ])("accepts auth kind %s", (kind) => {
    const callback = kind === "oauth2-authorization-code" ? { kind: "oauth" } : validDefinition.callback;
    expect(
      connectorDefinitionSchema.safeParse({ ...validDefinition, auth: { kind }, callback }).success,
    ).toBe(true);
  });

  it("rejects auth kinds outside the closed contract", () => {
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        auth: { kind: "basic" },
      }).success,
    ).toBe(false);
  });

  it.each(["none", "oauth", "webhook"])("accepts callback kind %s", (kind) => {
    const auth = kind === "oauth" ? { kind: "oauth2-authorization-code" } : validDefinition.auth;
    expect(
      connectorDefinitionSchema.safeParse({ ...validDefinition, auth, callback: { kind } }).success,
    ).toBe(true);
  });

  it("requires nonempty unique capabilities", () => {
    expect(
      connectorDefinitionSchema.safeParse({ ...validDefinition, capabilities: [] }).success,
    ).toBe(false);
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        capabilities: ["email.send", "email.send"],
      }).success,
    ).toBe(false);
  });

  it("enforces bounded retry values", () => {
    const operation = validDefinition.operations[0];
    for (const retry of [
      { ...operation.retry, maxAttempts: 0 },
      { ...operation.retry, maxAttempts: 11 },
      { ...operation.retry, initialDelayMs: -1 },
      { ...operation.retry, maxDelayMs: 300_001 },
      { ...operation.retry, initialDelayMs: 6_000, maxDelayMs: 5_000 },
    ]) {
      expect(
        connectorDefinitionSchema.safeParse({
          ...validDefinition,
          operations: [{ ...operation, retry }],
        }).success,
      ).toBe(false);
    }
  });

  it("requires an explicit sync declaration", () => {
    const { sync: _sync, ...withoutSync } = validDefinition;
    expect(connectorDefinitionSchema.safeParse(withoutSync).success).toBe(false);
  });

  it("requires every operation capability to be declared", () => {
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        operations: [
          { ...validDefinition.operations[0], capability: "email.undeclared" },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(["full", "incremental"] as const)(
    "requires a %s sync operation to reference a declared operation",
    (kind) => {
      const sync =
        kind === "full"
          ? { kind, operationId: "missing-operation" }
          : { kind, operationId: "missing-operation", cursorField: "cursor" };
      expect(connectorDefinitionSchema.safeParse({ ...validDefinition, sync }).success).toBe(false);
    },
  );

  it("requires authority resources to be unique even when modes conflict", () => {
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        authorities: [
          { resource: "email.delivery-status", mode: "source" },
          { resource: "email.delivery-status", mode: "platform" },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows oauth callbacks only for authorization-code auth", () => {
    expect(
      connectorDefinitionSchema.safeParse({
        ...validDefinition,
        auth: { kind: "api-key" },
        callback: { kind: "oauth" },
      }).success,
    ).toBe(false);
  });

  it("exposes the closed typed connector error taxonomy", () => {
    expect(CONNECTOR_ERROR_KINDS).toEqual([
      "configuration",
      "authentication",
      "authorization",
      "rate_limited",
      "upstream_unavailable",
      "invalid_payload",
      "not_connected",
      "internal",
    ]);
    const error = new ConnectorError("rate_limited", "Slow down", {
      retryAfterMs: 1_000,
    });
    expect(error).toMatchObject({
      name: "ConnectorError",
      kind: "rate_limited",
      retryAfterMs: 1_000,
      message: "Slow down",
    });
  });

  it("returns a deeply frozen, readonly definition", () => {
    const definition = parseConnectorDefinition(validDefinition);

    expectTypeOf(definition).toEqualTypeOf<ConnectorDefinition>();
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.capabilities)).toBe(true);
    expect(Object.isFrozen(definition.auth)).toBe(true);
    expect(Object.isFrozen(definition.operations)).toBe(true);
    expect(Object.isFrozen(definition.operations[0])).toBe(true);
    expect(Object.isFrozen(definition.operations[0].retry)).toBe(true);
    expect(Object.isFrozen(definition.sync)).toBe(true);
    expect(Object.isFrozen(definition.authorities)).toBe(true);
    expect(Object.isFrozen(definition.authorities[0])).toBe(true);
    expectTypeOf(definition.capabilities).toEqualTypeOf<readonly string[]>();
    expect(() => Array.prototype.push.call(definition.capabilities, "email.mutable")).toThrow(
      TypeError,
    );
    expect(Reflect.set(definition.operations[0].retry, "maxAttempts", 9)).toBe(false);
    expect(definition.operations[0].retry.maxAttempts).toBe(3);
  });
});
