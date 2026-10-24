// Install-managed map packs and the MapLibre runtime, served first-party
// (BI-814F86E1, design docs/superpowers/specs/2026-09-25-geographic-map-renderer-design.md §2.2–2.4).
//
// A pack is <packId>.pmtiles beside <packId>.manifest.json in one directory
// (DPF_MAP_DATA_DIR, default /var/lib/dpf/maps). Callers name a pack by id only:
// the id must pass the manifest pattern, resolve under the root, and have a
// valid manifest whose byte length matches the file. Nothing here takes a path
// or URL from the caller, so the install never proxies anything.

import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";

import { resolveMapAssetRange } from "./map-asset-range";
import { mapPackFileName, validateMapPackManifest, type MapPackManifest } from "./map-pack-manifest";

export const DEFAULT_MAP_DATA_DIR = "/var/lib/dpf/maps";
const MANIFEST_SUFFIX = ".manifest.json";

export function resolveMapDataDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DPF_MAP_DATA_DIR?.trim();
  return configured ? configured : DEFAULT_MAP_DATA_DIR;
}

/** The absolute path of a file directly under root, or null if it would escape. */
function underRoot(root: string, fileName: string): string | null {
  const base = path.resolve(root);
  const resolved = path.resolve(base, fileName);
  return path.dirname(resolved) === base ? resolved : null;
}

function packFileName(packId: string): string | null {
  try {
    return mapPackFileName(packId);
  } catch {
    return null;
  }
}

async function readManifest(root: string, packId: string): Promise<MapPackManifest | null> {
  const manifestPath = underRoot(root, `${packId}${MANIFEST_SUFFIX}`);
  if (!manifestPath) return null;
  try {
    const result = validateMapPackManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    return result.ok && result.value.packId === packId ? result.value : null;
  } catch {
    return null;
  }
}

/** Valid installed manifests, for the client to pick a pack covering its scene. */
export async function listInstalledMapPacks(root: string = resolveMapDataDir()): Promise<MapPackManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const ids = entries
    .filter((name) => name.endsWith(MANIFEST_SUFFIX))
    .map((name) => name.slice(0, -MANIFEST_SUFFIX.length))
    .filter((id) => packFileName(id) !== null)
    .sort();
  const manifests = await Promise.all(ids.map((id) => readManifest(root, id)));
  return manifests.filter((manifest): manifest is MapPackManifest => manifest !== null);
}

export type MapPackOpenResult =
  | { status: "missing" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; manifest: MapPackManifest; filePath: string };

export async function openMapPack(packId: string, root: string = resolveMapDataDir()): Promise<MapPackOpenResult> {
  const fileName = packFileName(packId);
  const filePath = fileName ? underRoot(root, fileName) : null;
  if (!filePath) return { status: "missing" };
  const manifest = await readManifest(root, packId);
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { status: "missing" };
    size = info.size;
  } catch {
    return { status: "missing" };
  }
  if (!manifest) return { status: "invalid", reason: "The pack has no valid manifest." };
  if (manifest.byteLength !== size) {
    return { status: "invalid", reason: "The pack file length does not match its manifest." };
  }
  return { status: "ok", manifest, filePath };
}

type PackRequest = {
  method: "GET" | "HEAD";
  rangeHeader: string | null;
  authenticated: boolean;
  root?: string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handleMapPackRequest(request: PackRequest, packId: string): Promise<Response> {
  if (!request.authenticated) return json(401, { error: "Unauthorized" });
  const opened = await openMapPack(packId, request.root ?? resolveMapDataDir());
  if (opened.status === "missing") return json(404, { status: "missing" });
  if (opened.status === "invalid") return json(409, { status: "invalid", reason: opened.reason });

  const total = opened.manifest.byteLength;
  const range = resolveMapAssetRange(request.rangeHeader, total);
  const common = {
    "Accept-Ranges": "bytes",
    ETag: `"${opened.manifest.sha256}"`,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Type": "application/vnd.pmtiles",
  };
  if (range.status === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${total}` } });
  }
  const headers: Record<string, string> = { ...common, "Content-Length": String(range.length) };
  if (range.status === "partial") headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
  const status = range.status === "partial" ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const stream = createReadStream(opened.filePath, { start: range.start, end: range.end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

// MapLibre 6 builds its worker from import.meta.url, which a bundler cannot
// rewrite, and the worker imports ./maplibre-gl-shared.mjs from beside itself.
// So exactly these two files are served from the pinned package (§2.4).
const RUNTIME_FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

function runtimeFilePath(file: string): string {
  const requireFromApp = createRequire(path.join(process.cwd(), "package.json"));
  return requireFromApp.resolve(`maplibre-gl/dist/${file}`);
}

export async function handleMapRuntimeRequest(request: { authenticated: boolean }, file: string): Promise<Response> {
  if (!request.authenticated) return json(401, { error: "Unauthorized" });
  if (!RUNTIME_FILES.has(file)) return new Response("Not found", { status: 404 });
  let body: string;
  try {
    body = await readFile(runtimeFilePath(file), "utf8");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // The file name carries no version, so revalidate rather than pin forever.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
