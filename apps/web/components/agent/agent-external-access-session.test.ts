import { beforeEach, describe, expect, it } from "vitest";
import {
  getExternalAccessSessionKey,
  loadExternalAccessSessionState,
  saveExternalAccessSessionState,
} from "./agent-external-access-session";

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

describe("agent external access session", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStorageMock,
      configurable: true,
    });
    sessionStorageMock.clear();
  });

  it("defaults to disabled for a user and route", () => {
    expect(loadExternalAccessSessionState("user-1", "/admin")).toBe(false);
  });

  it("stores state by user and route for the current session", () => {
    saveExternalAccessSessionState("user-1", "/admin", true);

    expect(loadExternalAccessSessionState("user-1", "/admin")).toBe(true);
    expect(loadExternalAccessSessionState("user-1", "/ops")).toBe(false);
    expect(loadExternalAccessSessionState("user-2", "/admin")).toBe(false);
  });

  it("uses a session-scoped storage key", () => {
    expect(getExternalAccessSessionKey("user-1", "/admin")).toBe(
      "agent-external-access-session:user-1:/admin",
    );
  });
});
