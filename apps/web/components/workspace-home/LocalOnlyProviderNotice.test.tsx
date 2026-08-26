import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import routeManifest from "@/lib/ea/route-manifest.json";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import { PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { CloudProviderUnclearedNotice } from "./CloudProviderUnclearedNotice";
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

// BI-575F0046. Connecting a cloud provider used to remove the local-only notice
// while the provider was cleared for `public` only — so the owner saw nothing at
// all and a workforce that silently stayed local.
describe("CloudProviderUnclearedNotice", () => {
  const markup = (names: string[]) =>
    renderToStaticMarkup(<CloudProviderUnclearedNotice providerNames={names} />);

  it("says the provider is connected, not that one is missing", () => {
    const html = markup(["ChatGPT"]);

    expect(html).toContain("ChatGPT is connected");
    // "Add a cloud provider" is the wrong instruction here — one is already added.
    expect(html).not.toContain("Add optional cloud AI");
  });

  it("points at the data-handling confirmation, which is the actual blocker", () => {
    const html = markup(["ChatGPT"]);

    expect(html).toContain("Confirm data handling");
    expect(html).toContain(AI_PROVIDER_CONNECTIONS_ROUTE);
  });

  it("summarises rather than listing every provider when several are waiting", () => {
    expect(markup(["ChatGPT", "Gemini"])).toContain("2 cloud providers");
  });

  // IDENTITY_BLOCK rule #5 applies to owner-facing copy too: no clearance
  // vocabulary, no sensitivity levels, no routing internals.
  it("explains the hold without exposing routing vocabulary", () => {
    const html = markup(["ChatGPT"]).toLowerCase();

    for (const jargon of ["clearance", "sensitivity", "restricted", "public-only", "routing"]) {
      expect(html, `owner-facing copy must not say "${jargon}"`).not.toContain(jargon);
    }
  });
});
