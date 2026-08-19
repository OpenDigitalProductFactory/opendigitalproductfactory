import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  grokDeviceLoginStart: vi.fn(),
  grokDeviceLoginComplete: vi.fn(),
}));
vi.mock("@/lib/build/grok-device-login-core", () => service);

import { grokSigninPack } from "./grok-signin-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["grok_signin_start", "grok_signin_status"];

const EXPECTED_GRANTS: Record<string, string[]> = {
  grok_signin_start: ["agent_control_read"],
  grok_signin_status: ["agent_control_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("grok-signin pack — registration", () => {
  it("exposes exactly the two Grok sign-in tools", () => {
    expect(grokSigninPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(grokSigninPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of grokSigninPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability + sideEffect metadata verbatim", () => {
    const byName = Object.fromEntries(grokSigninPack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe("manage_provider_connections");
      expect(byName[t].sideEffect, t).toBe(true);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(grokSigninPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("grok-signin pack — handler behavior (delegation preserved)", () => {
  it("grok_signin_start relays the verification URL + user code on success", async () => {
    service.grokDeviceLoginStart.mockResolvedValue({
      verificationUrl: "https://x.ai/oauth2/device",
      userCode: "ABCD-1234",
    });
    const res = await grokSigninPack.handlers.grok_signin_start({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("https://x.ai/oauth2/device");
    expect(res.message).toContain("ABCD-1234");
    expect(res.data).toEqual({ verificationUrl: "https://x.ai/oauth2/device", userCode: "ABCD-1234" });
  });

  it("grok_signin_start omits the code phrase when userCode is empty", async () => {
    service.grokDeviceLoginStart.mockResolvedValue({
      verificationUrl: "https://x.ai/oauth2/device",
      userCode: "",
    });
    const res = await grokSigninPack.handlers.grok_signin_start({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).not.toContain("confirm the code");
  });

  it("grok_signin_start surfaces a device-login error", async () => {
    service.grokDeviceLoginStart.mockResolvedValue({ error: "grok CLI not installed" });
    const res = await grokSigninPack.handlers.grok_signin_start({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("device_login_failed");
    expect(res.message).toBe("grok CLI not installed");
  });

  it("grok_signin_status reports the connected xAI provider on ok", async () => {
    service.grokDeviceLoginComplete.mockResolvedValue({ status: "ok" });
    const res = await grokSigninPack.handlers.grok_signin_status({}, "u1");
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("xai");
    expect(res.data).toEqual({ status: "ok" });
  });

  it("grok_signin_status reports pending while awaiting authorization", async () => {
    service.grokDeviceLoginComplete.mockResolvedValue({ status: "pending" });
    const res = await grokSigninPack.handlers.grok_signin_status({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ status: "pending" });
  });

  it("grok_signin_status surfaces a failure detail", async () => {
    service.grokDeviceLoginComplete.mockResolvedValue({ status: "failed", detail: "authorization denied" });
    const res = await grokSigninPack.handlers.grok_signin_status({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("device_login_failed");
    expect(res.message).toContain("authorization denied");
    expect(res.data).toEqual({ status: "failed" });
  });
});
