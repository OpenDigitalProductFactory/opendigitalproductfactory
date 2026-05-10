import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/coworker-self-assessment/assessment-service", () => ({
  linkNeedToBacklogItem: vi.fn(),
  resolveCapabilityNeed: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import {
  linkNeedToBacklogItem,
  resolveCapabilityNeed,
} from "@/lib/coworker-self-assessment/assessment-service";
import {
  linkCoworkerCapabilityNeedToBacklogAction,
  resolveCoworkerCapabilityNeedAction,
} from "./coworker-capability-needs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCoworkerCapabilityNeedAction", () => {
  it("records accepted, deferred, discarded, and duplicate review decisions", async () => {
    const formData = new FormData();
    formData.set("needId", "CWN-000001");
    formData.set("status", "duplicate");
    formData.set("duplicateOfId", "CWN-000000");
    formData.set("reviewerNote", "Same publishing gap.");

    await resolveCoworkerCapabilityNeedAction(formData);

    expect(resolveCapabilityNeed).toHaveBeenCalledWith("CWN-000001", {
      status: "duplicate",
      duplicateOfId: "CWN-000000",
      reviewerNote: "Same publishing gap.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/capability-needs");
  });

  it("rejects duplicate decisions without a canonical need id", async () => {
    const formData = new FormData();
    formData.set("needId", "CWN-000001");
    formData.set("status", "duplicate");

    await resolveCoworkerCapabilityNeedAction(formData);

    expect(resolveCapabilityNeed).not.toHaveBeenCalled();
  });
});

describe("linkCoworkerCapabilityNeedToBacklogAction", () => {
  it("links an accepted need to an existing backlog item", async () => {
    const formData = new FormData();
    formData.set("needId", "CWN-000001");
    formData.set("backlogItemId", "BI-F026ADD0");

    await linkCoworkerCapabilityNeedToBacklogAction(formData);

    expect(linkNeedToBacklogItem).toHaveBeenCalledWith("CWN-000001", "BI-F026ADD0");
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/capability-needs");
  });
});
