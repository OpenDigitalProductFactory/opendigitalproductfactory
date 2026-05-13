import { describe, expect, it } from "vitest";
import { resolveCoworkerRuntimeMode } from "./coworker-runtime-mode";

describe("resolveCoworkerRuntimeMode", () => {
  it("forces act mode in dev mode without silently enabling external access", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: true,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
        externalAccessEnabled: false,
      }),
    ).toEqual({
      coworkerMode: "act",
      externalAccessEnabled: false,
    });
  });

  it("forces act mode for build routes", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/build",
        devMode: false,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
        externalAccessEnabled: false,
      }),
    ).toEqual({
      coworkerMode: "act",
      externalAccessEnabled: true,
    });
  });

  it("uses legacy act behavior when unified coworker is disabled", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: false,
        useUnifiedCoworker: false,
        coworkerMode: "advise",
        externalAccessEnabled: false,
      }),
    ).toEqual({
      coworkerMode: "act",
      externalAccessEnabled: false,
    });
  });

  it("keeps advise mode behavior when unified coworker is enabled", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: false,
        useUnifiedCoworker: true,
        coworkerMode: "advise",
        externalAccessEnabled: false,
      }),
    ).toEqual({
      coworkerMode: "advise",
      externalAccessEnabled: false,
    });
  });

  it("keeps external access separate from unified act mode", () => {
    expect(
      resolveCoworkerRuntimeMode({
        pathname: "/compliance/licensing",
        devMode: false,
        useUnifiedCoworker: true,
        coworkerMode: "act",
        externalAccessEnabled: false,
      }),
    ).toEqual({
      coworkerMode: "act",
      externalAccessEnabled: false,
    });
  });
});
