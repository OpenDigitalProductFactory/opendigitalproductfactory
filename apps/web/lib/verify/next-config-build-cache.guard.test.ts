import { describe, expect, it, vi } from "vitest";

/**
 * `turbopackFileSystemCacheForBuild` must resolve to a strict boolean.
 *
 * The bug this guards: the option used to be written as
 * `process.env.DPF_TURBOPACK_BUILD_CACHE === "1" || undefined`, which yields
 * `undefined` whenever the env var is unset. `undefined` does not mean OFF to
 * Next — it means "unspecified", so Next falls back to its own default. On
 * Next 16.2 that default was OFF and the expression behaved as intended. Next
 * 16.3 turned the build cache ON by default, so the identical expression
 * silently enabled an experimental persistent cache in the shipped Docker
 * release image, while the config comment still asserted the release build
 * "leaves it OFF and is unaffected".
 *
 * A gate whose off-state is delegated to somebody else's default is not a gate.
 * Any future rewrite that reintroduces `undefined` fails here.
 */
describe("next.config turbopackFileSystemCacheForBuild", () => {
  const load = async () => {
    vi.resetModules();
    const mod = await import("../../next.config.mjs");
    return mod.default.experimental?.turbopackFileSystemCacheForBuild;
  };

  it("is OFF — explicitly, not by omission — when the opt-in env is unset", async () => {
    delete process.env.DPF_TURBOPACK_BUILD_CACHE;
    const value = await load();
    expect(value).toBe(false);
    expect(value).not.toBeUndefined();
  });

  it("is ON when the CI verification build opts in", async () => {
    process.env.DPF_TURBOPACK_BUILD_CACHE = "1";
    try {
      expect(await load()).toBe(true);
    } finally {
      delete process.env.DPF_TURBOPACK_BUILD_CACHE;
    }
  });

  it("never resolves to a non-boolean, so Next can never supply the default", async () => {
    for (const env of [undefined, "", "0", "1", "true"]) {
      if (env === undefined) delete process.env.DPF_TURBOPACK_BUILD_CACHE;
      else process.env.DPF_TURBOPACK_BUILD_CACHE = env;
      expect(typeof (await load())).toBe("boolean");
    }
    delete process.env.DPF_TURBOPACK_BUILD_CACHE;
  });
});
