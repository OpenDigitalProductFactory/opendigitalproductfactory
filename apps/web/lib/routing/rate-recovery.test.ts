// apps/web/lib/routing/rate-recovery.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock inngest client
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ ids: [] }),
}));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: mockSend },
}));

import { scheduleRecovery, cancelRecovery } from "./rate-recovery";

describe("rate-recovery", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it("scheduleRecovery sends an Inngest event", () => {
    scheduleRecovery("openai", "gpt-4o");
    expect(mockSend).toHaveBeenCalledWith({
      name: "ops/rate.recover",
      data: { providerId: "openai", modelId: "gpt-4o" },
    });
  });

  it("cancelRecovery is a no-op (idempotent recovery)", () => {
    // cancelRecovery no longer throws or does anything harmful
    expect(() => cancelRecovery("openai", "gpt-4o")).not.toThrow();
  });
});
