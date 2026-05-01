import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationCascadePicker } from "./LocationCascadePicker";

const noopSearch = vi.fn().mockResolvedValue([]);

describe("LocationCascadePicker", () => {
  it("disables region and locality until their parents are selected", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{ country: null, region: null, locality: null }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
      />,
    );

    expect(html).toContain('id="location-country"');
    expect(html).toContain('id="location-region"');
    expect(html).toContain('id="location-locality"');
    expect(html).toMatch(/id="location-region"[^>]*\sdisabled/);
    expect(html).toMatch(/id="location-locality"[^>]*\sdisabled/);
    expect(html).not.toMatch(/id="location-country"[^>]*\sdisabled/);
    expect(html).toContain("Select a country first.");
    expect(html).toContain("Select a region first.");
  });

  it("enables region search when a country is selected and locality stays disabled until region is set", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{
          country: { id: "country-us", label: "United States (US)" },
          region: null,
          locality: null,
        }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
        onCreateRegion={vi.fn()}
        onCreateLocality={vi.fn()}
      />,
    );

    expect(html).not.toMatch(/id="location-region"[^>]*\sdisabled/);
    expect(html).toMatch(/id="location-locality"[^>]*\sdisabled/);
    expect(html).not.toContain("Select a country first.");
    expect(html).toContain("Select a region first.");
  });

  it("enables locality search when both country and region are selected", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{
          country: { id: "country-us", label: "United States (US)" },
          region: { id: "region-tx", label: "Texas (TX)" },
          locality: null,
        }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
        onCreateRegion={vi.fn()}
        onCreateLocality={vi.fn()}
      />,
    );

    expect(html).not.toMatch(/id="location-region"[^>]*\sdisabled/);
    expect(html).not.toMatch(/id="location-locality"[^>]*\sdisabled/);
    expect(html).not.toContain("Select a region first.");
  });

  it("uses platform theme variables and avoids hardcoded colors", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{ country: null, region: null, locality: null }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
      />,
    );

    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("bg-[var(--dpf-surface-2)]");
    expect(html).not.toContain("text-gray-");
    expect(html).not.toContain("bg-white");
    expect(html).not.toContain("bg-black");
  });

  it("renders accessible label associations and combobox role", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{ country: null, region: null, locality: null }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
      />,
    );

    expect(html).toMatch(/<label[^>]*for="location-country"[^>]*>Country<\/label>/);
    expect(html).toMatch(/<label[^>]*for="location-region"[^>]*>Region<\/label>/);
    expect(html).toMatch(/<label[^>]*for="location-locality"[^>]*>Town \/ City<\/label>/);
    expect(html).not.toContain(">Locality</label>");
    expect(html).toMatch(/role="combobox"/);
  });

  it("uses request language for missing towns and cities instead of arbitrary active creation", () => {
    const html = renderToStaticMarkup(
      <LocationCascadePicker
        value={{
          country: { id: "country-us", label: "United States (US)" },
          region: { id: "region-tx", label: "Texas (TX)" },
          locality: null,
        }}
        onChange={vi.fn()}
        searchCountries={noopSearch}
        searchRegions={noopSearch}
        searchLocalities={noopSearch}
        onCreateRegion={vi.fn()}
        onCreateLocality={vi.fn()}
      />,
    );

    expect(html).toContain('placeholder="Search regions..."');
    expect(html).toContain('placeholder="Search towns or cities..."');
    expect(html).toContain('data-add-new-label="Request missing town / city"');
    expect(html).not.toContain("Add new locality");
  });
});
