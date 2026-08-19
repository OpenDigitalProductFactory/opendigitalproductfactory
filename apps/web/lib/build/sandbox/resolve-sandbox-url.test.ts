import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSandboxUrl } from "./resolve-sandbox-url";

describe("resolveSandboxUrl", () => {
  const originalEnv = process.env.SANDBOX_PREVIEW_URL;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SANDBOX_PREVIEW_URL;
    else process.env.SANDBOX_PREVIEW_URL = originalEnv;
  });

  describe("inside the compose network (SANDBOX_PREVIEW_URL set)", () => {
    beforeEach(() => {
      process.env.SANDBOX_PREVIEW_URL = "http://sandbox:3000";
    });

    it("maps the legacy sandbox-1 container id to the `sandbox` service", () => {
      const r = resolveSandboxUrl("dpf-sandbox-1", 3035);
      expect(r.internal).toBe("http://sandbox:3000");
      expect(r.host).toBe("http://localhost:3035");
    });

    it("maps pool container ids to their compose service names", () => {
      expect(resolveSandboxUrl("dpf-sandbox-2-1", 3037).internal).toBe("http://sandbox-2:3000");
      expect(resolveSandboxUrl("dpf-sandbox-3-1", 3038).internal).toBe("http://sandbox-3:3000");
    });

    it("falls back to the container id as service name for unknown containers", () => {
      // Assumes container name == service name on port 3000 (compose convention)
      const r = resolveSandboxUrl("dpf-sandbox-adhoc", 3040);
      expect(r.internal).toBe("http://dpf-sandbox-adhoc:3000");
      expect(r.host).toBe("http://localhost:3040");
    });
  });

  describe("local dev (SANDBOX_PREVIEW_URL unset)", () => {
    beforeEach(() => {
      delete process.env.SANDBOX_PREVIEW_URL;
    });

    it("returns localhost on the mapped host port for known containers", () => {
      const r = resolveSandboxUrl("dpf-sandbox-1", 3035);
      expect(r.internal).toBe("http://localhost:3035");
      expect(r.host).toBe("http://localhost:3035");
    });

    it("returns localhost on the provided hostPort for unknown containers", () => {
      const r = resolveSandboxUrl("dpf-sandbox-adhoc", 3041);
      expect(r.internal).toBe("http://localhost:3041");
      expect(r.host).toBe("http://localhost:3041");
    });
  });
});
