import { describe, expect, it, vi } from "vitest";

import {
  parseWorkroomPostureDefault,
  setWorkroomPostureDefault,
  type WorkroomPostureDefaultsClient,
} from "./workroom-posture-defaults";

vi.mock("@dpf/db", () => ({ prisma: {} }));

function clientWith(policy: unknown): WorkroomPostureDefaultsClient & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    decisionPerspectiveProfile: {
      findFirst: async () => ({ autonomyPolicy: policy }),
      updateMany: async (args: unknown) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  };
}

describe("setWorkroomPostureDefault (BI-397157EA)", () => {
  it("merges a one-field declaration over the decreed default instead of replacing it", async () => {
    const client = clientWith({
      other: true,
      workroomPostureDefault: { actionBoundary: "preauthorized", declaredBy: "u-1", declaredAt: "2026-09-18T11:34:48.959Z" },
    });
    await setWorkroomPostureDefault({ proactivityLevel: "assertive", declaredBy: "u-1", declaredAt: "2026-09-18T11:35:00.000Z" }, client);
    const write = client.writes[0] as { data: { autonomyPolicy: Record<string, unknown> } };
    expect(write.data.autonomyPolicy.other).toBe(true);
    expect(write.data.autonomyPolicy.workroomPostureDefault).toMatchObject({
      actionBoundary: "preauthorized",
      proactivityLevel: "assertive",
      declaredAt: "2026-09-18T11:35:00.000Z",
    });
  });

  it("starts from nothing when no default is decreed yet", async () => {
    const client = clientWith({});
    await setWorkroomPostureDefault({ actionBoundary: "propose", declaredBy: null, declaredAt: null }, client);
    const write = client.writes[0] as { data: { autonomyPolicy: Record<string, unknown> } };
    expect(parseWorkroomPostureDefault(write.data.autonomyPolicy.workroomPostureDefault)).toMatchObject({ actionBoundary: "propose" });
  });
});
