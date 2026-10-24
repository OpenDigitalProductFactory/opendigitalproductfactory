import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getNativeIntegrationIds } from "./native-integration-catalog";
import {
  INTEGRATIONS_INDEX_HREF,
  integrationSettingsHref,
  integrationSettingsHrefForChannel,
  routableIntegrationSlugs,
} from "./integration-settings-href";

// fileURLToPath, never `new URL(...).pathname`: on Windows the latter is
// "/D:/..." and readdirSync fails on every host here (BI-5CBDC146 class).
const INTEGRATIONS_DIR = fileURLToPath(new URL("../../app/(shell)/platform/tools/integrations/", import.meta.url));

describe("integrationSettingsHref", () => {
  it("links an integration that has a page", () => {
    expect(integrationSettingsHref("email-postmark")).toBe("/platform/tools/integrations/email-postmark");
  });

  it("refuses to link an integration with no page, instead of 404ing the reader", () => {
    // Five catalog ids have no route behind them (found by the room-addressing guard).
    expect(integrationSettingsHref("greenhouse")).toBeNull();
    expect(integrationSettingsHref("nonsense")).toBeNull();
    expect(integrationSettingsHref(null)).toBeNull();
  });

  it("maps a marketing channel id to its integration, which is what the approval queue meant", () => {
    expect(integrationSettingsHrefForChannel("email")).toBe("/platform/tools/integrations/email-postmark");
    expect(integrationSettingsHrefForChannel("linkedin")).toBe("/platform/tools/integrations/linkedin-personal-social");
    // A slug passed as a channel still works.
    expect(integrationSettingsHrefForChannel("linkedin-personal-social")).toBe("/platform/tools/integrations/linkedin-personal-social");
    // A channel with no integration page yields nothing rather than a guess.
    expect(integrationSettingsHrefForChannel("tiktok")).toBeNull();
  });

  it("agrees with the filesystem: every routable slug is a real directory and vice versa", () => {
    const dirs = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(routableIntegrationSlugs()).toEqual(dirs);
  });

  it("documents which catalog ids currently have no page, so the drift is visible", () => {
    const unroutable = getNativeIntegrationIds().filter((id) => integrationSettingsHref(id) === null);
    expect(unroutable.sort()).toEqual(["facebook", "google", "greenhouse", "linkedin-ads", "microsoft365"]);
  });

  it("offers the index as the fallback, which is a real page", () => {
    expect(routableIntegrationSlugs().length).toBeGreaterThan(0);
    expect(INTEGRATIONS_INDEX_HREF).toBe("/platform/tools/integrations");
  });
});
