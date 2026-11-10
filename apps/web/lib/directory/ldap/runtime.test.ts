import { describe, expect, it, vi } from "vitest";

import type { DirectoryProjection } from "../projection";
import {
  LDAP_DEFAULT_PORT,
  getLdapListenerStatus,
  isLdapListenerEnabled,
  requiresClientCertificate,
  resetLdapListenerStateForTest,
  resolveLdapListenerPort,
  startLdapListener,
  stopLdapListener,
} from "./runtime";

const projection: DirectoryProjection = {
  baseDn: "dc=example,dc=test",
  entries: [],
  fingerprint: "f",
  counts: { people: 0, agents: 0, services: 0, groups: 0 },
};

const tlsMaterial = {
  key: Buffer.from("key"),
  cert: Buffer.from("cert"),
  ca: Buffer.from("ca"),
};

const silentLogger = { log: () => {}, error: () => {} };

/** A stand-in for the tls.Server the real factory returns. */
function fakeServer(behaviour: "listens" | "fails" = "listens") {
  const handlers = new Map<string, (arg?: unknown) => void>();
  return {
    once(event: string, handler: (arg?: unknown) => void) {
      handlers.set(event, handler);
      return this;
    },
    removeListener(event: string) {
      handlers.delete(event);
      return this;
    },
    listen() {
      queueMicrotask(() => {
        if (behaviour === "listens") handlers.get("listening")?.();
        else handlers.get("error")?.(new Error("EADDRINUSE"));
      });
      return this;
    },
    close(callback?: () => void) {
      callback?.();
      return this;
    },
  };
}

function start(overrides: Parameters<typeof startLdapListener>[0] = {}) {
  return startLdapListener({
    logger: silentLogger,
    loadTls: () => tlsMaterial,
    loadProjection: async () => projection,
    verifyBind: async () => ({ bound: false }),
    createServer: (() => fakeServer()) as never,
    ...overrides,
  });
}

describe("isLdapListenerEnabled", () => {
  it("is off when the flag is unset, so an install never serves LDAP by accident", () => {
    expect(isLdapListenerEnabled({})).toBe(false);
  });

  it("is on only for an affirmative flag value", () => {
    expect(isLdapListenerEnabled({ DPF_LDAP_ENABLED: "1" })).toBe(true);
    expect(isLdapListenerEnabled({ DPF_LDAP_ENABLED: "false" })).toBe(false);
  });
});

describe("resolveLdapListenerPort", () => {
  it("defaults to the standard LDAPS port", () => {
    expect(resolveLdapListenerPort({})).toEqual({ port: LDAP_DEFAULT_PORT });
  });

  it("accepts an explicit port", () => {
    expect(resolveLdapListenerPort({ DPF_LDAP_PORT: "6360" })).toEqual({ port: 6360 });
  });

  it("refuses a non-numeric port instead of silently using the default", () => {
    const result = resolveLdapListenerPort({ DPF_LDAP_PORT: "six-three-six" });
    expect(result).toHaveProperty("error");
  });

  it("refuses an out-of-range port", () => {
    expect(resolveLdapListenerPort({ DPF_LDAP_PORT: "70000" })).toHaveProperty("error");
  });
});

describe("startLdapListener", () => {
  it("stays disabled and binds nothing when the flag is unset", async () => {
    resetLdapListenerStateForTest();
    const createServer = vi.fn();
    const status = await start({ env: {}, createServer: createServer as never });

    expect(status.state).toBe("disabled");
    expect(createServer).not.toHaveBeenCalled();
  });

  it("listens on the configured port when enabled and PKI material is present", async () => {
    resetLdapListenerStateForTest();
    const status = await start({ env: { DPF_LDAP_ENABLED: "1", DPF_LDAP_PORT: "6360" } });

    expect(status).toMatchObject({ state: "listening", port: 6360 });
    expect(getLdapListenerStatus().state).toBe("listening");
    await stopLdapListener();
  });

  it("refuses — rather than self-signing — when org PKI material is absent", async () => {
    resetLdapListenerStateForTest();
    const status = await start({
      env: { DPF_LDAP_ENABLED: "1" },
      loadTls: () => {
        throw new Error("refusing to start without organization PKI material");
      },
    });

    expect(status.state).toBe("refused");
    expect(status).toHaveProperty("reason", expect.stringContaining("organization PKI"));
  });

  it("refuses when the published tree cannot be built, rather than binding a directory with nothing to serve", async () => {
    resetLdapListenerStateForTest();
    const status = await start({
      env: { DPF_LDAP_ENABLED: "1" },
      loadProjection: async () => {
        throw new Error("no Organization exists");
      },
    });

    expect(status.state).toBe("refused");
    expect(status).toHaveProperty("reason", expect.stringContaining("no Organization exists"));
  });

  it("refuses when the port is already taken", async () => {
    resetLdapListenerStateForTest();
    const status = await start({
      env: { DPF_LDAP_ENABLED: "1" },
      createServer: (() => fakeServer("fails")) as never,
    });

    expect(status.state).toBe("refused");
    expect(status).toHaveProperty("reason", expect.stringContaining("could not bind port 636"));
  });

  it("refuses a malformed port without falling back to the default", async () => {
    resetLdapListenerStateForTest();
    const createServer = vi.fn();
    const status = await start({
      env: { DPF_LDAP_ENABLED: "1", DPF_LDAP_PORT: "not-a-port" },
      createServer: createServer as never,
    });

    expect(status.state).toBe("refused");
    expect(createServer).not.toHaveBeenCalled();
  });

  it("passes the mTLS posture through to the server", async () => {
    resetLdapListenerStateForTest();
    const createServer = vi.fn(() => fakeServer());
    await start({
      env: { DPF_LDAP_ENABLED: "1", DPF_LDAP_REQUIRE_CLIENT_CERTIFICATE: "1" },
      createServer: createServer as never,
    });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ requireClientCertificate: true }),
    );
    await stopLdapListener();
  });
});

describe("requiresClientCertificate", () => {
  it("defaults to off so password binds from ordinary clients still work", () => {
    expect(requiresClientCertificate({})).toBe(false);
  });
});
