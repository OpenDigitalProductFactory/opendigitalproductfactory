import { describe, it, expect, vi } from "vitest"
import * as fs from "node:fs/promises"

vi.mock("node:fs/promises")

import { GET } from "./route"

describe("GET /api/voice/audio/[...path]", () => {
  it("returns 200 with audio/mp3 content-type for existing file", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("FAKE_AUDIO") as any)
    const req = new Request("http://localhost/api/voice/audio/voice/DI-abc/file.mp3")
    const res = await GET(req, { params: Promise.resolve({ path: ["voice", "DI-abc", "file.mp3"] }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("audio/mpeg")
  })

  it("returns 404 for missing file", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    vi.mocked(fs.readFile).mockRejectedValue(err)
    const req = new Request("http://localhost/api/voice/audio/voice/DI-abc/missing.mp3")
    const res = await GET(req, { params: Promise.resolve({ path: ["voice", "DI-abc", "missing.mp3"] }) })
    expect(res.status).toBe(404)
  })

  it("rejects path traversal attempts", async () => {
    const req = new Request("http://localhost/api/voice/audio/../../etc/passwd")
    const res = await GET(req, { params: Promise.resolve({ path: ["..", "..", "etc", "passwd"] }) })
    expect(res.status).toBe(400)
  })
})
