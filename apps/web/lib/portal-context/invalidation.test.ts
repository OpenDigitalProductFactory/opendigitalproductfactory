import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from "next/cache";
import {
  revalidatePortalContext,
  revalidatePortalContextForBuild,
  revalidatePortalContextForTaskRun,
} from "./invalidation";

const mockRevalidateTag = revalidateTag as ReturnType<typeof vi.fn>;

describe("portal context invalidation", () => {
  beforeEach(() => {
    mockRevalidateTag.mockReset();
  });

  it("falls back to the broad portal context tag when no scoped tag is provided", () => {
    revalidatePortalContext();

    expect(mockRevalidateTag).toHaveBeenCalledWith("portal-context", "max");
  });

  it("keeps entity invalidation scoped when a build changes", () => {
    revalidatePortalContextForBuild("FB-123");

    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("portal-context:build:FB-123", "max");
  });

  it("scopes task-run invalidation to task and thread tags", () => {
    revalidatePortalContextForTaskRun("thread-1", "thread-1");

    expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    expect(mockRevalidateTag).toHaveBeenCalledWith("portal-context:task-run:thread-1", "max");
    expect(mockRevalidateTag).toHaveBeenCalledWith("portal-context:thread:thread-1", "max");
  });
});
