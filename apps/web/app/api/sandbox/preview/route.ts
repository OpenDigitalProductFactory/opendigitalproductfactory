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

  // Use Docker service name for container-to-container communication.
  // The sandbox container's internal port is 3000, mapped to sandboxPort on the host.
  // Inside Docker, we reach it via the container/service name, not localhost.
  const sandboxHost = build.sandboxId?.includes("sandbox") ? build.sandboxId : `localhost`;
  const sandboxInternalPort = 3000;
  const targetUrl = `http://${sandboxHost}:${sandboxInternalPort}${targetPath}`;

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
