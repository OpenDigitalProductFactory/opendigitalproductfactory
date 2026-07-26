// apps/web/app/api/docs-asset/[...path]/route.ts
//
// Serves static assets that live under docs/user-guide/assets/** to the in-portal
// docs renderer. The /docs route only renders markdown, and Next serves /public —
// so build-time-rendered Mermaid SVGs and screenshots (committed under the docs
// tree, EP-DOCS-SYSTEM Phase 2) need this route to reach the portal. Read-only,
// path-traversal-guarded, long-cache (rendered diagram URLs include their
// source-fence hash as a version query).

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

// Mirror of the user-guide dir resolution in apps/web/lib/shared/docs.ts.
// Resolved asset URLs already include their `assets/` segment, so the guarded
// root is the user-guide directory—not user-guide/assets (which would resolve
// an authored `assets/foo.svg` as `assets/assets/foo.svg`).
const prodDir = path.join(process.cwd(), "docs", "user-guide");
const devDir = path.resolve(process.cwd(), "..", "..", "docs", "user-guide");
const ASSETS_ROOT = fs.existsSync(prodDir) ? prodDir : devDir;

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const rel = (segments ?? []).join("/");
  const resolved = path.resolve(ASSETS_ROOT, rel);

  // Path-traversal guard: the resolved path must stay under ASSETS_ROOT.
  if (resolved !== ASSETS_ROOT && !resolved.startsWith(ASSETS_ROOT + path.sep)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const ext = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Read via a single file descriptor to avoid a check-then-read (TOCTOU) race:
  // fstat and read operate on the same open inode, so the file cannot be swapped
  // between the "is it a regular file?" check and the read.
  let fd: number;
  try {
    fd = fs.openSync(resolved, "r");
  } catch {
    // Missing file (ENOENT), or anything else that prevents opening — treat as 404.
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    if (!fs.fstatSync(fd).isFile()) {
      return new NextResponse("Not found", { status: 404 });
    }
    const body = fs.readFileSync(fd);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        // SVGs are sanitized at render time; still forbid inline script execution.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } finally {
    fs.closeSync(fd);
  }
}
