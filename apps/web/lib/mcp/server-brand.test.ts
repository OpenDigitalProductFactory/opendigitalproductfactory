// BI-20397491 — the MCP handshake carries the DPF mark and website.
//
// The reported gap: a client that draws a tile per connector had nothing to
// draw for DPF, because serverInfo carried a name and a version only. MCP
// 2025-11-25 (SEP-973) lets a server publish `icons` and `websiteUrl` on its
// Implementation. These tests pin what DPF publishes: the platform's own mark,
// inline so it resolves on an air-gapped install, and only on the revision
// that defines the fields.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformConfig: { findUnique: vi.fn() },
  hostProfile: vi.fn(),
  instanceStance: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { platformConfig: mocks.platformConfig } }));
vi.mock("@/lib/install/host-profile", () => ({
  readInstallHostProfile: () => mocks.hostProfile(),
}));
vi.mock("@/lib/install/instance-stance", () => ({
  loadInstanceStance: () => mocks.instanceStance(),
  prismaInstanceStanceStore: () => ({}),
}));
vi.mock("@/lib/mcp/org-context-bundle", () => ({
  buildOrgContextBundle: async () => ({}),
  formatOrgContextInstructions: (instructions: string) => instructions,
}));

import { buildMcpInitializeResult } from "./initialize";
import {
  MCP_SERVER_ICONS,
  MCP_SERVER_WEBSITE_URL,
  advertisesServerBrand,
} from "./server-brand";

const AUTHORITY = { scope: "admin" as const, scopes: ["admin_write"] };

const logo = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../public/logos/${name}`, import.meta.url)));

function decode(src: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+=*)$/.exec(src);
  if (!match) throw new Error(`not a base64 data URI: ${src.slice(0, 40)}`);
  return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
}

async function serverInfoFor(protocolVersion?: string): Promise<Record<string, unknown>> {
  const result = await buildMcpInitializeResult({
    ...(protocolVersion ? { params: { protocolVersion } } : {}),
    authority: AUTHORITY,
  });
  return result["serverInfo"] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostProfile.mockResolvedValue({
    kind: "consumer",
    installMode: "consumer",
    sourceCapable: false,
    releaseImage: true,
    reason: "consumer-release-install",
  });
  mocks.instanceStance.mockResolvedValue(undefined);
  mocks.platformConfig.findUnique.mockResolvedValue(null);
});

describe("the handshake carries the DPF mark and website", () => {
  it("publishes both to a client on the revision that defines them", async () => {
    const info = await serverInfoFor("2025-11-25");

    expect(info["websiteUrl"]).toBe("https://opendigitalproductfactory.com/");
    expect(info["websiteUrl"]).toBe(MCP_SERVER_WEBSITE_URL);
    expect(info["icons"]).toEqual(MCP_SERVER_ICONS);
    // Identity is untouched: the name still says which installation this is.
    expect(typeof info["name"]).toBe("string");
    expect(info["version"]).toBe("1.0.0");
  });

  it("leaves both out for a client on an earlier revision, whose schema has no such fields", async () => {
    for (const version of ["2025-06-18", "2025-03-26", "2024-11-05", undefined]) {
      const info = await serverInfoFor(version);
      expect(Object.keys(info)).not.toContain("icons");
      expect(Object.keys(info)).not.toContain("websiteUrl");
    }
  });

  it("decides by when the fields were introduced, so a later revision keeps them", () => {
    expect(advertisesServerBrand("2025-11-25")).toBe(true);
    expect(advertisesServerBrand("2026-06-30")).toBe(true);
    expect(advertisesServerBrand("2025-06-18")).toBe(false);
    expect(advertisesServerBrand("2024-11-05")).toBe(false);
  });
});

describe("every icon resolves from the handshake itself", () => {
  it("is inline, so nothing is fetched from another host or from behind sign-in", () => {
    expect(MCP_SERVER_ICONS.length).toBeGreaterThan(0);
    for (const icon of MCP_SERVER_ICONS) expect(icon.src.startsWith("data:")).toBe(true);
  });

  it("leads with a PNG, the format every icon-rendering client must support", () => {
    expect(MCP_SERVER_ICONS[0]!.mimeType).toBe("image/png");
  });

  it("is what it declares: the type in the URI, the bytes, and the size all agree", () => {
    for (const icon of MCP_SERVER_ICONS) {
      const { mimeType, bytes } = decode(icon.src);
      expect(mimeType).toBe(icon.mimeType);

      if (icon.mimeType === "image/png") {
        // PNG signature, then the IHDR chunk: width and height as big-endian u32.
        expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
        expect(icon.sizes).toEqual([`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`]);
      } else {
        expect(icon.mimeType).toBe("image/svg+xml");
        expect(bytes.toString("utf8").startsWith("<svg ")).toBe(true);
        expect(icon.sizes).toEqual(["any"]);
      }
    }
  });

  it("stays small: it rides on every connection", () => {
    expect(JSON.stringify(MCP_SERVER_ICONS).length).toBeLessThan(6000);
  });
});

describe("the icons are the platform's own brand", () => {
  it("are byte for byte the committed mark files", () => {
    const png = MCP_SERVER_ICONS.find((icon) => icon.mimeType === "image/png")!;
    const svg = MCP_SERVER_ICONS.find((icon) => icon.mimeType === "image/svg+xml")!;

    expect(decode(png.src).bytes.equals(logo("dpf-mark-96.png"))).toBe(true);
    expect(decode(svg.src).bytes.equals(logo("dpf-mark.svg"))).toBe(true);
  });

  it("the mark is the emblem of the platform wordmark, moved into a square", () => {
    // Drop the two wordmark text lines, then lift the emblem 4 units so it sits
    // in a 32x32 box with the 2-unit margin it has on the wordmark's left. If
    // the wordmark's gradient, corner radius or lettering changes, this fails
    // until the mark files and the constants in server-brand.ts are refreshed.
    const wordmark = logo("open-digital-product-factory-logo.svg").toString("utf8");
    const emblem = wordmark
      .split("\n")
      .filter((line) => !line.includes('x="38"'))
      .join("\n")
      .replace('viewBox="0 0 120 40" width="120" height="40"', 'viewBox="0 0 32 32" width="32" height="32"')
      .replace('<rect x="2" y="6"', '<rect x="2" y="2"')
      .replace('<text x="16" y="25"', '<text x="16" y="21"');

    expect(emblem).toContain(">DPF</text>");
    expect(logo("dpf-mark.svg").toString("utf8")).toBe(emblem);
  });
});
