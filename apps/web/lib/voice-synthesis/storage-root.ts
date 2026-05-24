import * as path from "node:path"

export interface ResolveVoiceStorageRootInput {
  uploadStoragePath?: string | null
  hostSourceMount?: string | null
  projectRoot?: string | null
  cwd?: string
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveVoiceStorageRoot(input: ResolveVoiceStorageRootInput = {}): string {
  const uploadStoragePath = nonEmpty(input.uploadStoragePath ?? process.env.UPLOAD_STORAGE_PATH)
  if (uploadStoragePath) return uploadStoragePath

  const hostSourceMount = nonEmpty(input.hostSourceMount ?? process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT)
  if (hostSourceMount) return path.join(hostSourceMount, "data", "uploads")

  const projectRoot = nonEmpty(input.projectRoot ?? process.env.PROJECT_ROOT)
  if (projectRoot) return path.join(projectRoot, "data", "uploads")

  return path.resolve(input.cwd ?? process.cwd(), "..", "..", "data", "uploads")
}
