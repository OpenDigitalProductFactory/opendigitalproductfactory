import { describe, expect, it } from "vitest";

import { parseLvfsAppstream, resolveLatestFirmware, type LvfsFirmware } from "./lvfs-firmware";

const CATALOG = `<?xml version="1.0"?>
<components origin="lvfs">
  <component type="firmware">
    <id>com.dell.poweredge.r750.firmware</id>
    <name>Dell PowerEdge R750 System BIOS</name>
    <developer_name>Dell Inc.</developer_name>
    <provides>
      <firmware type="flashed">AB1234CD-0000-0000-0000-000000000001</firmware>
      <firmware type="flashed">EF5678AB-0000-0000-0000-000000000002</firmware>
    </provides>
    <releases>
      <release version="1.9.2" date="2025-11-01"/>
      <release version="2.1.0" date="2026-05-14"/>
      <release version="2.0.5" date="2026-02-20"/>
    </releases>
  </component>
  <component type="firmware">
    <id>com.acme.widget</id>
    <name>Acme Widget Dock</name>
    <provides><firmware type="flashed">99999999-0000-0000-0000-000000000000</firmware></provides>
    <releases><release version="0.4" date="2024-01-01"/></releases>
  </component>
  <component type="desktop">
    <id>should.be.ignored</id>
    <name>Not firmware</name>
  </component>
</components>`;

describe("parseLvfsAppstream", () => {
  it("extracts firmware components with name, developer, GUIDs, and the newest release", () => {
    const parsed = parseLvfsAppstream(CATALOG);
    expect(parsed).toHaveLength(2); // the desktop component is ignored
    const dell = parsed.find((c) => c.name.includes("PowerEdge"))!;
    expect(dell.developer).toBe("Dell Inc.");
    expect(dell.guids).toEqual([
      "ab1234cd-0000-0000-0000-000000000001",
      "ef5678ab-0000-0000-0000-000000000002",
    ]);
    // Newest by date wins even though it is listed second.
    expect(dell.latestVersion).toBe("2.1.0");
    expect(dell.latestDate).toBe("2026-05-14");
  });

  it("skips a component with no name and tolerates empty input", () => {
    expect(parseLvfsAppstream(`<components><component type="firmware"><releases><release version="1"/></releases></component></components>`)).toEqual([]);
    expect(parseLvfsAppstream("")).toEqual([]);
  });
});

const COMPONENTS: LvfsFirmware[] = parseLvfsAppstream(CATALOG);

describe("resolveLatestFirmware", () => {
  it("prefers an exact device-GUID match (case-insensitive)", () => {
    const r = resolveLatestFirmware(COMPONENTS, {
      guid: "AB1234CD-0000-0000-0000-000000000001",
      manufacturer: "Nope",
      product: "Nope",
    });
    expect(r).toEqual({ version: "2.1.0", date: "2026-05-14", matchedBy: "guid" });
  });

  it("falls back to a normalized manufacturer/model name match", () => {
    const r = resolveLatestFirmware(COMPONENTS, { manufacturer: "Dell", product: "PowerEdge R750" });
    expect(r?.version).toBe("2.1.0");
    expect(r?.matchedBy).toBe("name");
  });

  it("returns null when neither GUID nor name matches", () => {
    expect(resolveLatestFirmware(COMPONENTS, { manufacturer: "HP", product: "ProLiant DL380" })).toBeNull();
  });

  it("does not name-match on vendor alone without the product", () => {
    expect(resolveLatestFirmware(COMPONENTS, { manufacturer: "Dell", product: "Latitude 5540" })).toBeNull();
  });
});
