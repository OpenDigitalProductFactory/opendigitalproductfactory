import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

import { buildMarketFootprint } from "@/lib/footprint/market-footprint";

import { FootprintView } from "./FootprintView";

const footprint = buildMarketFootprint({
  targetMarkets: [["US", "DE"]],
  accounts: [
    { accountId: "a1", siteCountries: ["US"] },
    { accountId: "a2", siteCountries: ["GB"] },
    { accountId: "a3", siteCountries: [] },
  ],
  deploymentSites: [{ siteId: "s1", country: "US" }],
});

describe("FootprintView", () => {
  const html = renderToStaticMarkup(
    <MessagesProvider locale="en-US" messages={{ footprint: namespaceMessages("en-US", "footprint") }}>
      <FootprintView footprint={footprint} peopleLabel="Customers" />
    </MessagesProvider>,
  );

  it("offers the four layers as a radio group with customers selected", () => {
    for (const label of ["Target markets", "Customers", "Deployments", "Language fit"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Customers</);
  });

  it("draws the world as an accessible image that points at the table", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain("The table below lists the same countries.");
    expect((html.match(/<path /g) ?? []).length).toBeGreaterThan(170);
  });

  it("lists the same countries as the map in the table, with unplaced customers stated above it", () => {
    const table = html.slice(html.indexOf("<table"));
    for (const name of ["United States of America", "Germany", "United Kingdom"]) {
      expect(table).toContain(name);
    }
    const notPlaced = html.indexOf("Not placed:");
    expect(notPlaced).toBeGreaterThan(-1);
    expect(notPlaced).toBeLessThan(html.indexOf("<table"));
  });

  it("uses theme tokens and patterns, never a hard-coded colour", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html).toContain("var(--dpf-accent)");
    expect(html).toContain('id="footprint-hatch"');
  });
});
