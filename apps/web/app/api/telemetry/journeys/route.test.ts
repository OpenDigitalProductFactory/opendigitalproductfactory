import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

import { POST } from "./route";
import { metricsRegistry } from "@/lib/metrics";

function post(body: unknown, raw?: string) {
  return POST(
    new Request("http://localhost/api/telemetry/journeys", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

async function scrape(): Promise<string> {
  return metricsRegistry.metrics();
}

describe("POST /api/telemetry/journeys (BI-BD0B0DCC)", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("refuses an unauthenticated caller and records nothing (AC-6)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await post({ samples: [{ kind: "journey", journey: "message-ack", totalMs: 100 }] });
    expect(res.status).toBe(401);
    expect(await scrape()).not.toMatch(/dpf_journey_duration_seconds_count\{[^}]*\} [1-9]/);
  });

  it("records journey total and server phases and web vitals into the registry (AC-4)", async () => {
    const res = await post({
      samples: [
        { kind: "journey", journey: "message-ack", totalMs: 180, serverMs: 40 },
        { kind: "vital", metric: "INP", value: 96, section: "workspace" },
        { kind: "vital", metric: "CLS", value: 0.04, section: "workspace" },
      ],
    });
    expect(res.status).toBe(204);
    const text = await scrape();
    expect(text).toContain('dpf_journey_duration_seconds_count{journey="message-ack",phase="total"} 1');
    expect(text).toContain('dpf_journey_duration_seconds_count{journey="message-ack",phase="server"} 1');
    expect(text).toContain('dpf_web_vital_seconds_count{metric="INP",section="workspace"} 1');
    expect(text).toContain('dpf_web_vital_cls_count{section="workspace"} 1');
  });

  it("drops invalid samples and maps unknown sections to other (AC-6)", async () => {
    await post({
      samples: [
        { kind: "journey", journey: "not-a-journey", totalMs: 10 },
        { kind: "vital", metric: "LCP", value: 900, section: "no-such-section" },
      ],
    });
    const text = await scrape();
    expect(text).not.toContain("not-a-journey");
    expect(text).not.toContain("no-such-section");
    expect(text).toContain('dpf_web_vital_seconds_count{metric="LCP",section="other"} 1');
  });

  it("answers 204 to a malformed body without recording", async () => {
    const res = await post(undefined, "{not json");
    expect(res.status).toBe(204);
  });
});
