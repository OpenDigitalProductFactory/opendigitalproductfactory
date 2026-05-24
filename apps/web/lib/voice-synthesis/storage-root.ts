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

function pathApiFor(value: string): typeof path {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") ? path.win32 : path
}

function joinStorageRoot(root: string): string {
  return pathApiFor(root).join(root, "data", "uploads")
}

export function resolveVoiceStorageRoot(input: ResolveVoiceStorageRootInput = {}): string {
  const uploadStoragePath = nonEmpty(input.uploadStoragePath ?? process.env.UPLOAD_STORAGE_PATH)
  if (uploadStoragePath) return uploadStoragePath

  const hostSourceMount = nonEmpty(input.hostSourceMount ?? process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT)
  if (hostSourceMount) return joinStorageRoot(hostSourceMount)

  const projectRoot = nonEmpty(input.projectRoot ?? process.env.PROJECT_ROOT)
  if (projectRoot) return joinStorageRoot(projectRoot)

  const cwd = input.cwd ?? process.cwd()
  return pathApiFor(cwd).resolve(cwd, "..", "..", "data", "uploads")
}
