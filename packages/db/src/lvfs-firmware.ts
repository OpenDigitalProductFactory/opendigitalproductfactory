// LVFS / fwupd firmware model hints (BI-84710E60 follow-up, HAM Phase D1, spec §5.2).
// The LVFS publishes firmware as AppStream metadata: one `<component type="firmware">`
// per device with a human `<name>`, the device `<provides><firmware>` GUIDs, and a
// `<releases>` history. This parses that (narrowly — only the elements we need) and
// resolves the latest firmware version for a hardware CatalogIdentity, matched by device
// GUID when the estate carries one, else by normalized manufacturer/model name.
//
// Substrate note (spec §5.2 / §7): DPF discovery collects firmware *version* today (e.g.
// UniFi `firmwareVersion`) but not device GUIDs, so the current match path is name-based;
// a firmware-GUID collector (follow-up) will raise the match rate. The module is pure and
// fixture-tested — the sweep fetches + decompresses the catalog once and passes the XML in.

/** One firmware component distilled from an LVFS AppStream `<component type="firmware">`. */
export type LvfsFirmware = {
  name: string;
  developer: string | null;
  /** Device GUIDs this firmware flashes (lowercased). */
  guids: string[];
  latestVersion: string | null;
  latestDate: string | null;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXmlEntities(m[1]!.trim()) : null;
}

/**
 * Parse the firmware components out of an LVFS AppStream metadata document (already
 * decompressed). Tolerant of unknown elements; skips components with no name. The latest
 * release is the one with the newest `date` (falling back to first-listed when undated).
 */
export function parseLvfsAppstream(xml: string): LvfsFirmware[] {
  if (typeof xml !== "string" || xml.length === 0) return [];
  const out: LvfsFirmware[] = [];
  // Each firmware component. LVFS uses type="firmware"; be lenient about attribute order.
  const componentRe = /<component\b[^>]*\btype=["']firmware["'][^>]*>([\s\S]*?)<\/component>/gi;
  let comp: RegExpExecArray | null;
  while ((comp = componentRe.exec(xml)) !== null) {
    const body = comp[1]!;
    const name = tagText(body, "name");
    if (!name) continue;

    const guids: string[] = [];
    const provideRe = /<firmware\b[^>]*>([\s\S]*?)<\/firmware>/gi;
    let g: RegExpExecArray | null;
    while ((g = provideRe.exec(body)) !== null) {
      const guid = decodeXmlEntities(g[1]!.trim()).toLowerCase();
      if (guid) guids.push(guid);
    }

    // Releases: pick the newest by date; `date` is an ISO string on LVFS releases.
    let latestVersion: string | null = null;
    let latestDate: string | null = null;
    const releaseRe = /<release\b([^>]*)\/?>(?:([\s\S]*?)<\/release>)?/gi;
    let r: RegExpExecArray | null;
    while ((r = releaseRe.exec(body)) !== null) {
      const attrs = r[1] ?? "";
      const version = attrs.match(/\bversion=["']([^"']+)["']/i)?.[1] ?? null;
      const date = attrs.match(/\bdate=["']([^"']+)["']/i)?.[1] ?? null;
      if (!version) continue;
      if (latestDate === null || (date !== null && date > latestDate)) {
        latestVersion = version;
        latestDate = date;
      }
    }

    out.push({ name, developer: tagText(body, "developer_name"), guids, latestVersion, latestDate });
  }
  return out;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type FirmwareMatchKey = {
  /** Device GUID from discovery, when present (the reliable key). */
  guid?: string | null;
  manufacturer: string;
  product: string;
};

export type ResolvedFirmware = { version: string; date: string | null; matchedBy: "guid" | "name" };

/**
 * Resolve the latest firmware for a hardware identity. Prefers an exact GUID match; falls
 * back to a name match (the component name contains the normalized product, and the vendor
 * matches the component name or developer). Returns null when nothing matches or the match
 * has no versioned release.
 */
export function resolveLatestFirmware(
  components: LvfsFirmware[],
  key: FirmwareMatchKey,
): ResolvedFirmware | null {
  const guid = key.guid?.toLowerCase().trim();
  if (guid) {
    const byGuid = components.find((c) => c.guids.includes(guid));
    if (byGuid?.latestVersion) {
      return { version: byGuid.latestVersion, date: byGuid.latestDate, matchedBy: "guid" };
    }
  }

  const product = normalize(key.product);
  const vendor = normalize(key.manufacturer);
  if (product === "") return null;
  const byName = components.find((c) => {
    const compName = normalize(c.name);
    const dev = c.developer ? normalize(c.developer) : "";
    return compName.includes(product) && (vendor === "" || compName.includes(vendor) || dev.includes(vendor));
  });
  if (byName?.latestVersion) {
    return { version: byName.latestVersion, date: byName.latestDate, matchedBy: "name" };
  }
  return null;
}
