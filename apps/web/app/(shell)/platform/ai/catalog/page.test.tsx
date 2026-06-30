import { describe, expect, it } from "vitest";

import { PORTAL_NAV_ROUTES } from "@/lib/navigation/portal-navigation-model";

describe("AI Workforce catalog route", () => {
  it("is registered as an AI Workforce section page", () => {
    expect(PORTAL_NAV_ROUTES).toContainEqual(
      expect.objectContaining({
        key: "platform-ai-catalog",
        label: "Catalog",
        path: "/platform/ai/catalog",
        parentPath: "/platform/ai",
        destinationKind: "section-page",
      }),
    );
  });
});

