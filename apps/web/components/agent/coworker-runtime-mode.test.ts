import { describe, expect, it } from "vitest";
import { resolveCoworkerRuntimeMode } from "./coworker-runtime-mode";

describe("resolveCoworkerRuntimeMode", () => {
  it("forces act mode with external access in dev mode", () => {
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
      externalAccessEnabled: true,
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

  it("forces external access on in unified act mode", () => {
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
      externalAccessEnabled: true,
    });
  });
});
