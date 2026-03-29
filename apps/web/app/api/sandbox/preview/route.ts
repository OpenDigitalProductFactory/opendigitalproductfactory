// apps/web/app/api/sandbox/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

// Map container IDs to Docker Compose service names (for internal routing)
const CONTAINER_TO_SERVICE: Record<string, string> = {
  "dpf-sandbox-1": "sandbox",
  "dpf-sandbox-2-1": "sandbox-2",
  "dpf-sandbox-3-1": "sandbox-3",
};

// Map container IDs to host-mapped ports (for local dev routing)
const CONTAINER_TO_PORT: Record<string, number> = {
  "dpf-sandbox-1": 3035,
  "dpf-sandbox-2-1": 3037,
  "dpf-sandbox-3-1": 3038,
};

/**
 * Resolves the sandbox base URL for a given container ID.
 * Inside Docker (SANDBOX_PREVIEW_URL is set): uses Compose service names.
 * Local dev: uses host-mapped ports on localhost.
 */
function resolveSandboxUrl(sandboxId: string, hostPort: number): string {
  const isDocker = !!process.env.SANDBOX_PREVIEW_URL;
  if (isDocker) {
    const service = CONTAINER_TO_SERVICE[sandboxId];
    if (service) return `http://${service}:3000`;
    // Fallback: assume container name IS the service name on port 3000
    return `http://${sandboxId}:3000`;
  }
  // Local dev: use the host-mapped port
  const port = CONTAINER_TO_PORT[sandboxId] ?? hostPort;
  return `http://localhost:${port}`;
}

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

  // Route to the correct sandbox container based on sandboxId.
  // Inside Docker: Compose service name (e.g. sandbox-2:3000).
  // Local dev: host-mapped port (e.g. localhost:3037).
  const sandboxBase = resolveSandboxUrl(build.sandboxId, build.sandboxPort);
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
    // Sandbox exists but no web server is running yet — auto-refresh until it's up
    const statusHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Sandbox</title>
<meta http-equiv="refresh" content="5">
<style>body{font-family:system-ui;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:32px;border:1px solid #333;border-radius:12px;max-width:400px}
h2{color:#7c8cf8;margin:0 0 8px}p{font-size:13px;color:#888;line-height:1.5}
.spinner{width:24px;height:24px;border:3px solid #333;border-top:3px solid #7c8cf8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="card">
<div class="spinner"></div>
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
