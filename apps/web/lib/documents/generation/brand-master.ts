// Brand masters from the Organization (BI-3A0E5413, slice S6 of BI-815D40C6).
//
// Organization is the canonical identity (AGENTS.md §8): its name, address,
// logo and structured brand (`designSystem`, a BrandDesignSystem) are the only
// inputs. Where the record is silent the master uses neutral defaults rather
// than inventing brand values (the same rule as lib/brand/generation-context.ts).
//
// Each (organization, family) master is a managed Document, `BRANDMASTER-<org
// id>-<family>`, whose versions hold the flat-ODF bytes as a DocumentBlob. The
// XML is deterministic, so its SHA-256 is the brand's fingerprint: a render
// reuses the current version while the brand is unchanged and writes the next
// version the first time it sees a changed brand. Nothing is regenerated on a
// timer and no brand write path has to remember to call this.

import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { isBrandDesignSystem } from "@/lib/brand/types";
import { probeImage } from "@/lib/media/image-probe";
import { formatOrgAddressLines, parseOrgAddress } from "@/lib/shared/org-address";
import {
  BRAND_MASTER_BUILDERS,
  BRAND_MASTER_EXTENSION,
  BRAND_MASTER_MIME,
  contrastText,
  type BrandLogo,
  type BrandMasterInput,
} from "./brand-master-xml";
import type { RenderTheme, ResolvedTemplate } from "./render";
import type { DocumentFamily } from "./spec";

export const BRAND_MASTER_DOCUMENT_KIND = "brand-master";
/** A logo is embedded in every master and every generated file; keep it small. */
export const MAX_BRAND_LOGO_BYTES = 2 * 1024 * 1024;
/** Letter-size paper where it is the norm; A4 everywhere else. */
const LETTER_PAPER_COUNTRIES = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE"]);

/** Office-document colours for an organization with no brand record; they never style the portal. */
export const NEUTRAL_BRAND = {
  primary: "#1f4e79", // style-drift-allow
  secondary: "#5b6b79", // style-drift-allow
  background: "#ffffff", // style-drift-allow
  foreground: "#1d2a33", // style-drift-allow
  font: "Liberation Sans",
} as const;

export type BrandSource = {
  id: string;
  name: string;
  designSystem: unknown;
  logoUrl: string | null;
  address: unknown;
};

function hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

function fontName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // The first family of a CSS stack, without quotes: "'Inter', sans-serif" -> Inter.
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  return /^[A-Za-z0-9 ._-]{1,64}$/.test(first) ? first : null;
}

/** The master's inputs, read from the Organization record only. */
export function brandMasterInputFrom(source: BrandSource, logo: BrandLogo | null): BrandMasterInput {
  const system = isBrandDesignSystem(source.designSystem) ? source.designSystem : null;
  const palette = system?.palette;
  const families = system?.typography?.families;
  const address = parseOrgAddress(source.address);
  const body = fontName(families?.sans) ?? NEUTRAL_BRAND.font;
  return {
    organizationName: source.name,
    primary: hex(palette?.primary) ?? NEUTRAL_BRAND.primary,
    secondary: hex(palette?.secondary) ?? NEUTRAL_BRAND.secondary,
    background: hex(palette?.surfaces?.background) ?? NEUTRAL_BRAND.background,
    foreground: hex(palette?.surfaces?.foreground) ?? NEUTRAL_BRAND.foreground,
    headingFont: fontName(families?.display) ?? body,
    bodyFont: body,
    paper: LETTER_PAPER_COUNTRIES.has((address.countryCode ?? "").toUpperCase()) ? "letter" : "a4",
    addressLines: formatOrgAddressLines(source.address),
    logo,
  };
}

/** Colours dpf-render applies where a template cannot carry them: chart series and diagram shapes. */
export function brandThemeFor(input: BrandMasterInput, source?: BrandSource): RenderTheme {
  const system = source && isBrandDesignSystem(source.designSystem) ? source.designSystem : null;
  const accents = (system?.palette?.accents ?? []).map(hex).filter((value): value is string => value !== null);
  return {
    chartColours: [...new Set([input.primary, input.secondary, ...accents])],
    shapeFill: input.primary,
    shapeStroke: input.secondary,
    shapeText: contrastText(input.primary),
  };
}

function embeddable(content: Buffer): BrandLogo | null {
  if (content.length === 0 || content.length > MAX_BRAND_LOGO_BYTES) return null;
  const probed = probeImage(content);
  if (probed.mimeType !== "image/png" && probed.mimeType !== "image/jpeg" && probed.mimeType !== "image/gif") return null;
  return { mimeType: probed.mimeType, data: content, widthPx: probed.width ?? 0, heightPx: probed.height ?? 0 };
}

/** A `data:` URI logo (how brand extraction records uploads), if it is a PNG, JPEG or GIF. */
export function logoFromDataUri(url: string): BrandLogo | null {
  const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(url.trim());
  if (!match || !match[1]) return null;
  return embeddable(Buffer.from(match[2], "base64"));
}

/**
 * The organization's logo bytes: its stored MediaAsset (Organization.logoUrl is
 * the served /api/media/<id> URL), else an uploaded `data:` logo in the brand
 * record. A remote URL is never fetched here; logo-ingest owns that.
 */
async function loadBrandLogo(source: BrandSource): Promise<BrandLogo | null> {
  const assetId = /^\/api\/media\/([A-Za-z0-9_-]+)$/.exec(source.logoUrl ?? "")?.[1];
  if (assetId) {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { organizationId: true, storageKey: true, storageDriver: true },
    });
    if (asset && asset.organizationId === source.id) {
      const { getMediaStorageDriver } = await import("@/lib/media/media-storage");
      const logo = embeddable(await getMediaStorageDriver(asset.storageDriver).get(asset.storageKey));
      if (logo) return logo;
    }
  }
  const system = isBrandDesignSystem(source.designSystem) ? source.designSystem : null;
  const ref = system?.identity?.logo?.lightBg ?? system?.identity?.logo?.mark;
  return ref?.url ? logoFromDataUri(ref.url) : null;
}

export type BrandMasterDeps = {
  loadOrganization?: (organizationId: string) => Promise<BrandSource | null>;
  loadLogo?: (source: BrandSource) => Promise<BrandLogo | null>;
  loadCurrentVersion?: (documentId: string) => Promise<{ version: number; contentSha256: string | null } | null>;
  storeVersion?: (args: {
    documentId: string;
    organizationId: string;
    title: string;
    family: DocumentFamily;
    xml: string;
    sha256: string;
    mime: string;
  }) => Promise<{ version: number }>;
};

export type BrandMaster = ResolvedTemplate & {
  documentId: string;
  version: number;
  sha256: string;
  /** True when this call wrote a new version because the brand changed (or there was none). */
  regenerated: boolean;
  theme: RenderTheme;
};

async function loadOrganization(organizationId: string): Promise<BrandSource | null> {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, designSystem: true, logoUrl: true, address: true },
  });
}

async function loadCurrentVersion(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { documentId },
    select: { currentVersion: { select: { version: true, contentSha256: true } } },
  });
  return document?.currentVersion ?? null;
}

async function storeVersion(args: Parameters<NonNullable<BrandMasterDeps["storeVersion"]>>[0]) {
  const [{ storeDocumentBlob }, { saveManagedDocument }] = await Promise.all([
    import("@/lib/documents/blob-storage"),
    import("@/lib/documents/document-store"),
  ]);
  const blob = await storeDocumentBlob({ content: args.xml, mimeType: args.mime });
  const saved = await saveManagedDocument({
    documentId: args.documentId,
    organizationId: args.organizationId,
    title: args.title,
    documentKind: BRAND_MASTER_DOCUMENT_KIND,
    contentFormat: args.mime,
    contentBlobId: blob.id,
    contentSha256: blob.sha256,
    summary: `The ${args.family} master generated from this organization's brand record. It is rewritten whenever the brand changes.`,
    tags: [BRAND_MASTER_DOCUMENT_KIND, args.family],
    accessScope: "organization",
  });
  return { version: saved.currentVersion?.version ?? 1 };
}

/** The organization's current master for a family: reused while the brand is unchanged, else a new version. */
export async function ensureBrandMaster(
  args: { organizationId: string; family: DocumentFamily },
  deps: BrandMasterDeps = {},
): Promise<BrandMaster> {
  const source = await (deps.loadOrganization ?? loadOrganization)(args.organizationId);
  if (!source) throw new Error(`No organization ${args.organizationId} to build a brand master from.`);
  const logo = await (deps.loadLogo ?? loadBrandLogo)(source);
  const input = brandMasterInputFrom(source, logo);
  const ext = BRAND_MASTER_EXTENSION[args.family];
  const xml = BRAND_MASTER_BUILDERS[args.family](input);
  const sha256 = createHash("sha256").update(xml, "utf8").digest("hex");
  const documentId = `BRANDMASTER-${source.id}-${args.family}`;
  const theme = brandThemeFor(input, source);

  const current = await (deps.loadCurrentVersion ?? loadCurrentVersion)(documentId);
  if (current && current.contentSha256 === sha256) {
    return { ext, xml, theme, documentId, version: current.version, sha256, regenerated: false };
  }
  const stored = await (deps.storeVersion ?? storeVersion)({
    documentId,
    organizationId: source.id,
    title: `${source.name} ${args.family} master`,
    family: args.family,
    xml,
    sha256,
    mime: BRAND_MASTER_MIME[ext],
  });
  return { ext, xml, theme, documentId, version: stored.version, sha256, regenerated: true };
}

/** renderDocument's default template loader for `{ kind: "brand-master" }`. */
export async function loadBrandMasterTemplate(args: {
  organizationId: string;
  family: DocumentFamily;
}): Promise<ResolvedTemplate> {
  const master = await ensureBrandMaster(args);
  return { ext: master.ext, xml: master.xml, theme: master.theme };
}
