import { describe, expect, it } from "vitest";
import { resolveCoworkerRuntimeMode } from "./coworker-runtime-mode";

describe("resolveCoworkerRuntimeMode", () => {
  it("forces act mode in dev mode", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: true,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
      }),
    ).toEqual({ coworkerMode: "act" });
  });

  it("forces act mode for build routes", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/build",
        devMode: false,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
      }),
    ).toEqual({ coworkerMode: "act" });
  });

  it("uses legacy act behavior when unified coworker is disabled", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: false,
        useUnifiedCoworker: false,
        coworkerMode: "advise",
      }),
    ).toEqual({ coworkerMode: "act" });
  });

  it("keeps the user's advise choice when unified coworker is enabled", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: false,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
      }),
    ).toEqual({ coworkerMode: "advise" });
  });

  it("carries no web-access decision — that follows the Workroom, server-side", () => {
    const out = resolveCoworkerRuntimeMode({
      pathname: "/build",
      devMode: false,
      useUnifiedCoworker: true,
      coworkerMode: "advise",
    });
    expect("externalAccessEnabled" in out).toBe(false);
  });
});
