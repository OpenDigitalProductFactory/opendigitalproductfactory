import { describe, expect, it } from "vitest";

import { resetSweepPage } from "./ux-route-sweep";

describe("resetSweepPage", () => {
  it("waits for the blank isolation navigation to finish before the next route starts", async () => {
    let navigationFinished = false;
    let releaseNavigation!: () => void;
    const navigationFinishedPromise = new Promise<void>((resolve) => {
      releaseNavigation = () => {
        navigationFinished = true;
        resolve();
      };
    });
    const page = {
      goto: async (
        url: string,
        options: { waitUntil: "commit" | "load"; timeout: number },
      ) => {
        expect(url).toBe("about:blank");
        expect(options.timeout).toBe(10_000);
        if (options.waitUntil === "commit") return null;
        await navigationFinishedPromise;
        return null;
      },
    };

    let resetFinished = false;
    const reset = resetSweepPage(page).then(() => {
      resetFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(navigationFinished).toBe(false);
    expect(resetFinished).toBe(false);
    releaseNavigation();
    await reset;
    expect(navigationFinished).toBe(true);
    expect(resetFinished).toBe(true);
  });
});
