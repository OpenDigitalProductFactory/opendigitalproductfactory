// GET /api/platform/image-version — what source identity is this portal serving?
//
// Reads /app/.dpf-image-version (stamped at image build time per Dockerfile)
// and reports its raw value plus a `source` classification so admins and
// scripts can answer "is the running portal at origin/main, or is some stale
// image still tagged :latest after a concurrent build clobbered it?"
//
// Public — same trust profile as /api/health and /api/platform/status.

import { NextResponse } from "next/server";
import { readImageVersion } from "@/lib/platform/image-version";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
};

export async function GET() {
  const version = await readImageVersion();
  const body = version
    ? { present: true, version: version.raw, source: version.source }
    : { present: false, version: null, source: null };
  return NextResponse.json(body, { headers: NO_CACHE_HEADERS });
}
