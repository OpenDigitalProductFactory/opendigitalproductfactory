import { describe, expect, it, vi } from "vitest";

import {
  resolveInngestSelfRegistrationEndpoint,
  syncInngestSelfRegistration,
} from "./inngest-self-registration";

describe("resolveInngestSelfRegistrationEndpoint", () => {
  it("uses the reachable IPv4 listener when APP_URL is unset", () => {
    expect(resolveInngestSelfRegistrationEndpoint({ PORT: "3000" })).toBe(
      "http://127.0.0.1:3000/api/inngest",
    );
  });

  it("normalizes an explicit server-owned APP_URL without changing its host", () => {
    expect(resolveInngestSelfRegistrationEndpoint({
      APP_URL: "https://portal.example.test/",
      PORT: "4000",
    })).toBe("https://portal.example.test/api/inngest");
  });
});

describe("syncInngestSelfRegistration", () => {
  it("records truthful success and reconciles accepted runs only after an OK PUT", async () => {
    const fetchRegistration = vi.fn(async () => ({ ok: true, status: 200 }));
    const recordRegistration = vi.fn(async () => undefined);
    const reconcileAdmissions = vi.fn(async () => ({ attempted: 1, dispatched: 1 }));

    const result = await syncInngestSelfRegistration({
      endpoint: "http://127.0.0.1:3000/api/inngest",
      fetchRegistration,
      recordRegistration,
      reconcileAdmissions,
    });

    expect(result).toEqual({ ok: true, data: { status: 200 } });
    expect(fetchRegistration).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/inngest",
      { method: "PUT" },
    );
    expect(recordRegistration).toHaveBeenCalledWith(true, null);
    expect(reconcileAdmissions).toHaveBeenCalledOnce();
  });

  it("persists a non-OK response and never reconciles against false health", async () => {
    const recordRegistration = vi.fn(async () => undefined);
    const reconcileAdmissions = vi.fn(async () => ({ attempted: 0, dispatched: 0 }));

    const result = await syncInngestSelfRegistration({
      endpoint: "http://127.0.0.1:3000/api/inngest",
      fetchRegistration: vi.fn(async () => ({ ok: false, status: 503 })),
      recordRegistration,
      reconcileAdmissions,
    });

    expect(result).toEqual({ ok: false, error: "HTTP 503" });
    expect(recordRegistration).toHaveBeenCalledWith(false, "Inngest re-sync failed: HTTP 503");
    expect(reconcileAdmissions).not.toHaveBeenCalled();
  });

  it("persists a transport failure and never reconciles", async () => {
    const recordRegistration = vi.fn(async () => undefined);
    const reconcileAdmissions = vi.fn(async () => ({ attempted: 0, dispatched: 0 }));

    const result = await syncInngestSelfRegistration({
      endpoint: "http://127.0.0.1:3000/api/inngest",
      fetchRegistration: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
      recordRegistration,
      reconcileAdmissions,
    });

    expect(result).toEqual({ ok: false, error: "fetch failed" });
    expect(recordRegistration).toHaveBeenCalledWith(
      false,
      "Inngest re-sync failed: fetch failed",
    );
    expect(reconcileAdmissions).not.toHaveBeenCalled();
  });
});
