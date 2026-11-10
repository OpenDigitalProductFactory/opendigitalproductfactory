import { beforeEach, describe, expect, it } from "vitest";
import { loadCoworkerMode, saveCoworkerMode } from "./agent-external-access-session";

const store = new Map<string, string>();

const sessionStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  clear: () => {
    store.clear();
  },
};

describe("coworker mode session state", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStorageMock,
      configurable: true,
    });
    sessionStorageMock.clear();
  });

  it("defaults to advise for a user and route", () => {
    expect(loadCoworkerMode("user-1", "/admin")).toBe("advise");
  });

  it("stores the mode by user and route for the current session", () => {
    saveCoworkerMode("user-1", "/admin", "act");
    expect(loadCoworkerMode("user-1", "/admin")).toBe("act");
    expect(loadCoworkerMode("user-1", "/ops")).toBe("advise");
    expect(loadCoworkerMode("user-2", "/admin")).toBe("advise");
  });

  it("no longer exposes a per-session web-access state (EP-WORK-POSTURE 8.2)", async () => {
    const mod = await import("./agent-external-access-session");
    expect("loadExternalAccessSessionState" in mod).toBe(false);
    expect("buildExternalAccessContinuationPrompt" in mod).toBe(false);
  });
});
