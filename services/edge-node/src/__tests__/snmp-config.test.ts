import { describe, expect, it } from "vitest";

import {
  resolveSnmpConfig,
  type SnmpConfigAdapter,
} from "../collectors/snmp-config";

function makeAdapter(
  overrides: Partial<SnmpConfigAdapter> = {},
): SnmpConfigAdapter {
  return {
    env: {},
    readFile: () => {
      throw new Error("not implemented");
    },
    statMode: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    ...overrides,
  };
}

describe("resolveSnmpConfig — file absent", () => {
  it("returns empty + source=none when the config file does not exist", () => {
    const result = resolveSnmpConfig(makeAdapter());
    expect(result.targets).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.source).toBe("none");
  });

  it("honors DPF_EDGE_SNMP_CONFIG to override the default path", () => {
    const paths: string[] = [];
    resolveSnmpConfig(
      makeAdapter({
        env: { DPF_EDGE_SNMP_CONFIG: "/custom/path/snmp.json" },
        statMode: (p) => {
          paths.push(p);
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      }),
    );
    expect(paths).toEqual(["/custom/path/snmp.json"]);
  });
});

describe("resolveSnmpConfig — permission warnings", () => {
  it("warns when config is group-readable but still reads it", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o644,
        readFile: () =>
          JSON.stringify({
            targets: [
              {
                host: "10.0.0.1",
                version: "2c",
                community: "public",
              },
            ],
          }),
      }),
    );
    expect(result.targets).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/group\/world-readable.*mode 0644/);
    expect(result.warnings[0]).toMatch(/chmod 0600/);
  });

  it("no perms warning at mode 0600", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              { host: "10.0.0.1", version: "2c", community: "public" },
            ],
          }),
      }),
    );
    expect(
      result.warnings.some((w) => /group\/world-readable/.test(w)),
    ).toBe(false);
  });
});

describe("resolveSnmpConfig — content validation", () => {
  it("returns warning + empty targets on malformed JSON", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () => "{ not valid json",
      }),
    );
    expect(result.targets).toEqual([]);
    expect(result.warnings[0]).toMatch(/not valid JSON/);
  });

  it("rejects top-level shape that lacks a targets array", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () => JSON.stringify({ devices: [] }),
      }),
    );
    expect(result.targets).toEqual([]);
    expect(result.warnings[0]).toMatch(/must be a JSON object with a "targets"/);
  });

  it("parses a single SNMPv2c target", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              {
                host: "192.168.1.1",
                version: "2c",
                community: "public",
              },
            ],
          }),
      }),
    );
    expect(result.targets).toHaveLength(1);
    const t = result.targets[0]!;
    expect(t.host).toBe("192.168.1.1");
    expect(t.version).toBe("2c");
    if (t.version === "2c") expect(t.community).toBe("public");
    expect(t.port).toBe(161);
    expect(t.timeoutMs).toBe(5000);
  });

  it("parses an SNMPv3 target with all required fields", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              {
                host: "192.168.1.1",
                version: "3",
                user: "dpf-readonly",
                authProtocol: "SHA",
                authPassword: "AuthPassword!",
                privProtocol: "AES",
                privPassword: "PrivPassword!",
                port: 16161,
                timeoutMs: 10_000,
              },
            ],
          }),
      }),
    );
    expect(result.targets).toHaveLength(1);
    const t = result.targets[0]!;
    expect(t.version).toBe("3");
    if (t.version === "3") {
      expect(t.user).toBe("dpf-readonly");
      expect(t.authProtocol).toBe("SHA");
      expect(t.privProtocol).toBe("AES");
    }
    expect(t.port).toBe(16161);
    expect(t.timeoutMs).toBe(10_000);
  });

  it("skips v2c target missing community + warns", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [{ host: "10.0.0.1", version: "2c" }],
          }),
      }),
    );
    expect(result.targets).toEqual([]);
    expect(result.warnings.some((w) => /v2c requires "community"/.test(w))).toBe(
      true,
    );
  });

  it("skips v3 target with bad authProtocol + warns", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              {
                host: "10.0.0.1",
                version: "3",
                user: "u",
                authProtocol: "MD7", // not a valid value
                authPassword: "p",
                privProtocol: "AES",
                privPassword: "p",
              },
            ],
          }),
      }),
    );
    expect(result.targets).toEqual([]);
    expect(result.warnings.some((w) => /v3 requires/.test(w))).toBe(true);
  });

  it("rejects port out of range", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              {
                host: "10.0.0.1",
                version: "2c",
                community: "c",
                port: 70000,
              },
            ],
          }),
      }),
    );
    expect(result.targets).toEqual([]);
    expect(result.warnings.some((w) => /port out of range/.test(w))).toBe(true);
  });

  it("skips garbage version values", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [{ host: "10.0.0.1", version: "1", community: "c" }],
          }),
      }),
    );
    expect(result.targets).toEqual([]);
    expect(
      result.warnings.some((w) => /version must be "2c" or "3"/.test(w)),
    ).toBe(true);
  });

  it("keeps valid targets while skipping bad ones in the same file", () => {
    const result = resolveSnmpConfig(
      makeAdapter({
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              { host: "10.0.0.1", version: "2c", community: "c" },
              { version: "2c", community: "c" }, // missing host
              { host: "10.0.0.2", version: "2c", community: "c" },
            ],
          }),
      }),
    );
    expect(result.targets.map((t) => t.host)).toEqual([
      "10.0.0.1",
      "10.0.0.2",
    ]);
    expect(result.warnings.some((w) => /missing required "host"/.test(w))).toBe(
      true,
    );
  });
});
