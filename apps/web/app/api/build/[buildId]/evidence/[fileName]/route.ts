// Serves per-build UX-verification screenshots from the shared
// browser_evidence volume. browser-use writes screenshots into
// /evidence/build_<buildId>/<fileName>.png during run_ux_test; this
// route is how the portal exposes them back to the ReviewPanel UI.
//
// Auth: caller must own the build (session.user.id === build.createdById).
// Path traversal: both route segments are regex-validated, and the
// resolved filesystem path must stay under /evidence.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

const EVIDENCE_ROOT = "/evidence";
const BUILD_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const FILE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+\.png$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ buildId: string; fileName: string }> },
): Promise<NextResponse> {
  const { buildId, fileName } = await params;

  if (!BUILD_ID_PATTERN.test(buildId)) {
    return NextResponse.json({ error: "invalid buildId" }, { status: 400 });
  }
  if (!FILE_NAME_PATTERN.test(fileName) || fileName.length > 64) {
    return NextResponse.json({ error: "invalid fileName" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true },
  });
  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }
  if (build.createdById !== session.user.id && !session.user.isSuperuser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Defense in depth: compose + resolve + containment check, even though
  // both segments are already regex-validated above.
  const base = path.resolve(EVIDENCE_ROOT);
  const target = path.resolve(path.join(base, `build_${buildId}`, fileName));
  if (!target.startsWith(base + path.sep)) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  let body: Buffer;
  try {
    body = await readFile(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Convert Node Buffer to Uint8Array for NextResponse (type-safe body).
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
