import { describe, expect, it } from "vitest";
import {
  resolveAdaptersConfig,
  type AdaptersConfigAdapter,
} from "../collectors/adapters-config";

function makeAdapter(
  files: Record<string, { contents: string; mode: number }>,
  env: Record<string, string | undefined> = {},
): AdaptersConfigAdapter {
  return {
    env,
    readFile: (p) => {
      const entry = files[p];
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return entry.contents;
    },
    statMode: (p) => {
      const entry = files[p];
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return entry.mode;
    },
  };
}

describe("resolveAdaptersConfig", () => {
  it("returns empty config + source=none when no file present", () => {
    const result = resolveAdaptersConfig(makeAdapter({}));
    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
    expect(result.source).toBe("none");
  });

  it("loads a valid unifi block", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: JSON.stringify({
            unifi: {
              controllerUrl: "https://192.168.1.1",
              apiKey: "secret-key",
              site: "default",
            },
          }),
          mode: 0o600,
        },
      }),
    );
    expect(result.source).toBe("file");
    expect(result.warnings).toEqual([]);
    expect(result.config.unifi).toEqual({
      controllerUrl: "https://192.168.1.1",
      apiKey: "secret-key",
      site: "default",
      tlsInsecure: false,
    });
  });

  it("trims trailing slashes from controllerUrl and defaults site/tlsInsecure", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: JSON.stringify({
            unifi: { controllerUrl: "https://udm.local///", apiKey: "k" },
          }),
          mode: 0o600,
        },
      }),
    );
    expect(result.config.unifi).toEqual({
      controllerUrl: "https://udm.local",
      apiKey: "k",
      site: "default",
      tlsInsecure: false,
    });
  });

  it("honors DPF_EDGE_ADAPTERS_CONFIG override", () => {
    const result = resolveAdaptersConfig(
      makeAdapter(
        {
          "/custom/path.json": {
            contents: JSON.stringify({
              unifi: { controllerUrl: "https://h", apiKey: "k" },
            }),
            mode: 0o600,
          },
        },
        { DPF_EDGE_ADAPTERS_CONFIG: "/custom/path.json" },
      ),
    );
    expect(result.config.unifi?.apiKey).toBe("k");
  });

  it("warns on world-readable file but still reads it", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: JSON.stringify({
            unifi: { controllerUrl: "https://h", apiKey: "k" },
          }),
          mode: 0o644,
        },
      }),
    );
    expect(result.warnings[0]).toMatch(/group\/world-readable/);
    expect(result.config.unifi?.apiKey).toBe("k");
  });

  it("warns + skips a unifi block missing required fields", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: JSON.stringify({ unifi: { controllerUrl: "https://h" } }),
          mode: 0o600,
        },
      }),
    );
    expect(result.config.unifi).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("apiKey"))).toBe(true);
  });

  it("warns + skips unifi when controllerUrl is not http(s)", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: JSON.stringify({
            unifi: { controllerUrl: "udm.local", apiKey: "k" },
          }),
          mode: 0o600,
        },
      }),
    );
    expect(result.config.unifi).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("http://"))).toBe(true);
  });

  it("warns on invalid JSON", () => {
    const result = resolveAdaptersConfig(
      makeAdapter({
        "/etc/dpf-edge/adapters.json": {
          contents: "{ not json",
          mode: 0o600,
        },
      }),
    );
    expect(result.config).toEqual({});
    expect(result.warnings[0]).toMatch(/not valid JSON/);
  });
});
