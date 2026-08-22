import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import routeManifest from "@/lib/ea/route-manifest.json";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import { PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { LocalOnlyProviderNotice } from "./LocalOnlyProviderNotice";

type RouteManifest = {
  routes?: Array<{ routePath?: string }>;
};

describe("LocalOnlyProviderNotice", () => {
  it("links provider recovery to the canonical provider connections route", () => {
    const html = renderToStaticMarkup(<LocalOnlyProviderNotice />);

    expect(html).toContain(`href="${AI_PROVIDER_CONNECTIONS_ROUTE}"`);
    expect(html).not.toContain("/platform/ai-operations/providers");
    expect(html).toContain("built-in local AI is ready");
    expect(html).toContain("cloud provider is optional");
  });

  it("keeps the recovery target registered as the AI Operations provider surface", () => {
    const routes = new Set(
      ((routeManifest as RouteManifest).routes ?? []).map((route) => route.routePath),
    );
    const aiFamily = PLATFORM_FAMILIES.find((family) => family.key === "ai");

    expect(routes.has(AI_PROVIDER_CONNECTIONS_ROUTE)).toBe(true);
    expect(aiFamily?.subItems).toContainEqual(
      expect.objectContaining({
        href: AI_PROVIDER_CONNECTIONS_ROUTE,
        label: "Providers & Routing",
      }),
    );
  });
});
