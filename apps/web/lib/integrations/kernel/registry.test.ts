import { describe, expect, it } from "vitest";

import {
  connectorRegistry,
} from "../connectors";
import { parseConnectorDefinition } from "./definition";
import {
  createConnectorRegistry,
  type ConnectorRegistryEntry,
} from "./registry";

function definition(key: string, capability: string): ConnectorRegistryEntry {
  return {
    definition: parseConnectorDefinition({
      schemaVersion: 1,
      key,
      displayName: key,
      capabilities: [capability],
      auth: { kind: "none" },
      callback: { kind: "none" },
      operations: [],
      health: { probeIntervalSeconds: 300 },
      sync: { kind: "none" },
      authorities: [{ resource: `${key}.resource`, mode: "source" }],
    }),
  };
}

function mutableAdapterEntry() {
  let privateCount = 0;
  const adapter = {
    definition: definition("adapter", "capability.adapter").definition,
    invoke(value: string) {
      privateCount += 1;
      return `${value}:${privateCount}`;
    },
  };
  return { adapter, entry: { definition: adapter.definition, adapter } };
}

describe("createConnectorRegistry", () => {
  it("rejects duplicate connector IDs", () => {
    expect(() => createConnectorRegistry([
      definition("duplicate", "capability.one"),
      definition("duplicate", "capability.two"),
    ])).toThrow(/duplicate connector key/i);
  });

  it("rejects capabilities owned by more than one connector", () => {
    expect(() => createConnectorRegistry([
      definition("one", "capability.shared"),
      definition("two", "capability.shared"),
    ])).toThrow(/duplicate capability/i);
  });

  it("provides deterministic key, capability, and list lookup", () => {
    const registry = createConnectorRegistry([
      definition("zeta", "capability.zeta"),
      definition("alpha", "capability.alpha"),
    ]);

    expect(registry.list().map(({ definition }) => definition.key)).toEqual(["alpha", "zeta"]);
    expect(registry.get("alpha")?.definition.key).toBe("alpha");
    expect(registry.getByCapability("capability.zeta")?.definition.key).toBe("zeta");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("keeps registry results and nested definition data deeply immutable", () => {
    const registry = createConnectorRegistry([definition("one", "capability.one")]);
    const listed = registry.list();
    const entry = listed[0]!;

    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.definition)).toBe(true);
    expect(Object.isFrozen(entry.definition.capabilities)).toBe(true);
    expect(Object.isFrozen(entry.definition.health)).toBe(true);
    expect(Object.isFrozen(entry.definition.authorities[0])).toBe(true);
    expect(() => {
      (entry.definition.capabilities as string[]).push("mutated");
    }).toThrow();
  });

  it("captures a frozen adapter facade without freezing legitimate private state", () => {
    const { adapter, entry } = mutableAdapterEntry();
    const registry = createConnectorRegistry([entry]);
    const facade = registry.get("adapter")!.adapter!;
    const capturedInvoke = facade.invoke;

    adapter.invoke = () => "replaced";

    expect(Object.isFrozen(facade)).toBe(true);
    expect(Object.isFrozen(facade.definition.capabilities)).toBe(true);
    expect(capturedInvoke("first")).toBe("first:1");
    expect(facade.invoke("second")).toBe("second:2");
    expect(adapter.invoke("ignored")).toBe("replaced");
    expect(() => {
      (facade as { invoke: (value: string) => string }).invoke = () => "mutated";
    }).toThrow();
  });
});

describe("canonical connector registry", () => {
  it("registers stable schema-v1 definitions in deterministic order", () => {
    expect(connectorRegistry.list().map(({ definition }) => [
      definition.key,
      definition.schemaVersion,
    ])).toEqual([
      ["email-postmark", 1],
      ["microsoft365-communications", 1],
    ]);
  });

  it.each([
    ["email-postmark", "postmark"],
    ["microsoft365-communications", "microsoft365"],
  ])("projects shared safe state, health, and capabilities for %s", (key, provider) => {
    const sourceDate = new Date("2026-07-17T12:00:00.000Z");
    const sourceProjection = { account: "safe-value", nested: { enabled: true } };
    const projected = connectorRegistry.project(key, {
      integrationId: key,
      provider,
      status: "connected",
      safeProjection: sourceProjection,
      lastErrorMsg: null,
      lastTestedAt: sourceDate,
    }, { latestProbeFailed: true });

    expect(projected).toMatchObject({
      schemaVersion: 1,
      key,
      health: { status: "degraded", probeIntervalSeconds: 300 },
      state: {
        provider,
        status: "degraded",
        safeProjection: { account: "safe-value", nested: { enabled: true } },
        lastTestedAt: "2026-07-17T12:00:00.000Z",
      },
    });
    expect(projected.capabilities.length).toBeGreaterThan(0);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.capabilities)).toBe(true);
    expect(Object.isFrozen(projected.state.safeProjection.nested)).toBe(true);
    expect(Object.isFrozen(sourceDate)).toBe(false);

    sourceDate.setUTCFullYear(2030);
    sourceProjection.nested.enabled = false;
    expect(projected.state.lastTestedAt).toBe("2026-07-17T12:00:00.000Z");
    expect(projected.state.safeProjection.nested).toEqual({ enabled: true });
    expect(() => {
      (projected.state.safeProjection.nested as { enabled: boolean }).enabled = false;
    }).toThrow();
  });

  it("projects an unconfigured connector without vendor-specific state mapping", () => {
    expect(connectorRegistry.project("email-postmark", null)).toMatchObject({
      key: "email-postmark",
      state: { provider: null, status: "unconfigured", safeProjection: {} },
      health: { status: "unconfigured" },
    });
  });

  it("rejects projection for an unknown connector", () => {
    expect(() => connectorRegistry.project("unknown", null)).toThrow(/unknown connector/i);
  });
});
