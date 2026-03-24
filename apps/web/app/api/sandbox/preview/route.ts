// apps/web/app/api/sandbox/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buildId = request.nextUrl.searchParams.get("buildId");
  if (!buildId) {
    return NextResponse.json({ error: "buildId required" }, { status: 400 });
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { sandboxPort: true, sandboxId: true, createdById: true },
  });

  if (!build?.sandboxPort || !build.sandboxId) {
    return NextResponse.json({ error: "Sandbox not running" }, { status: 404 });
  }

  if (build.createdById !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sanitize path: ensure it starts with / and contains no protocol-relative patterns
  let targetPath = request.nextUrl.searchParams.get("path") ?? "/";
  if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
  targetPath = targetPath.replace(/\/\//g, "/");

  // Inside Docker the portal reaches the sandbox via Compose service name (sandbox:3000).
  // When running locally with `pnpm dev`, the sandbox container is reachable on the
  // host-mapped port (localhost:3035).  SANDBOX_PREVIEW_URL is set in docker-compose.yml
  // for the portal service; when absent we fall back to the host-mapped address.
  const sandboxBase =
    process.env.SANDBOX_PREVIEW_URL ?? "http://localhost:3035";
  const targetUrl = `${sandboxBase}${targetPath}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: { "Accept": request.headers.get("Accept") ?? "*/*" },
      signal: AbortSignal.timeout(5_000),
    });

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/html",
      },
    });
  } catch {
    // Sandbox exists but no web server is running yet — show a helpful status page
    const statusHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Sandbox</title>
<style>body{font-family:system-ui;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:32px;border:1px solid #333;border-radius:12px;max-width:400px}
h2{color:#7c8cf8;margin:0 0 8px}p{font-size:13px;color:#888;line-height:1.5}</style></head>
<body><div class="card">
<h2>Sandbox Active</h2>
<p>Build: ${buildId}</p>
<p>The sandbox environment is running. Code is being generated — the preview will update automatically when the dev server starts.</p>
</div></body></html>`;
    return new NextResponse(statusHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }
}
