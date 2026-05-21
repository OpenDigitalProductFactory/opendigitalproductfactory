import * as fs from "node:fs/promises"
import * as path from "node:path"
import { NextResponse } from "next/server"

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
}

function getStorageRoot(): string {
  return process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads"
}

export async function GET(
  _req: Request,
  { params }: { params: { path: string[] } },
): Promise<NextResponse> {
  const joined = (params.path ?? []).join("/")

  // Reject path traversal
  if (joined.includes("..") || path.isAbsolute(joined)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }

  const absolutePath = path.join(getStorageRoot(), joined)
  const ext = path.extname(joined).slice(1).toLowerCase()
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream"

  try {
    const buf = await fs.readFile(absolutePath)
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    })
  } catch (err: any) {
    if (err?.code === "ENOENT") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
