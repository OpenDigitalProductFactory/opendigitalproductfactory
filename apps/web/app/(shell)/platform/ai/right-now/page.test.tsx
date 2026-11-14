import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`redirect:${href}`); }));
vi.mock("next/navigation", () => ({ redirect }));

import RightNowPage from "./page";

describe("RightNowPage", () => {
  it("preserves supported focus parameters while redirecting to the canonical activity view", async () => {
    await expect(RightNowPage({ searchParams: Promise.resolve({ capsuleId: "WC-1", taskRunId: "TR-2", ignored: "no" }) }))
      .rejects.toThrow("redirect:/workforce?view=activity&capsuleId=WC-1&taskRunId=TR-2");
  });
});
