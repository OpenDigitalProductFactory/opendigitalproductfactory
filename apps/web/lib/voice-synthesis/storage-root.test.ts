import { describe, expect, it } from "vitest"
import { resolveVoiceStorageRoot } from "./storage-root"

describe("resolveVoiceStorageRoot", () => {
  it("uses explicit upload storage path first", () => {
    expect(resolveVoiceStorageRoot({
      uploadStoragePath: "/custom/uploads",
      hostSourceMount: "/host-dpf",
      projectRoot: "/workspace",
      cwd: "/workspace/apps/web",
    })).toBe("/custom/uploads")
  })

  it("uses the host install mount for production portal persistence", () => {
    expect(resolveVoiceStorageRoot({
      hostSourceMount: "/host-dpf",
      projectRoot: "/workspace",
      cwd: "/workspace/apps/web",
    }).replace(/\\/g, "/")).toBe("/host-dpf/data/uploads")
  })

  it("uses the project root when only a workspace mount is available", () => {
    expect(resolveVoiceStorageRoot({
      projectRoot: "/workspace",
      cwd: "/workspace/apps/web",
    }).replace(/\\/g, "/")).toBe("/workspace/data/uploads")
  })

  it("keeps Windows project roots absolute on non-Windows runners", () => {
    expect(resolveVoiceStorageRoot({
      projectRoot: "D:/DPF",
      cwd: "/workspace/apps/web",
    }).replace(/\\/g, "/")).toBe("D:/DPF/data/uploads")
  })

  it("falls back from apps/web to the repository data/uploads directory", () => {
    expect(resolveVoiceStorageRoot({
      cwd: "D:/DPF/apps/web",
    }).replace(/\\/g, "/")).toBe("D:/DPF/data/uploads")
  })
})
