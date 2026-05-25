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

function isWindowsAbsolute(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")
}

function joinDataUploads(root: string): string {
  if (isWindowsAbsolute(root)) {
    return path.win32.join(root, "data", "uploads")
  }
  return path.join(root, "data", "uploads")
}

function resolveRepoDataUploads(cwd: string): string {
  if (isWindowsAbsolute(cwd)) {
    return path.win32.resolve(cwd, "..", "..", "data", "uploads")
  }
  return path.resolve(cwd, "..", "..", "data", "uploads")
}

export function resolveVoiceStorageRoot(input: ResolveVoiceStorageRootInput = {}): string {
  const uploadStoragePath = nonEmpty(input.uploadStoragePath ?? process.env.UPLOAD_STORAGE_PATH)
  if (uploadStoragePath) return uploadStoragePath

  const hostSourceMount = nonEmpty(input.hostSourceMount ?? process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT)
  if (hostSourceMount) return joinDataUploads(hostSourceMount)

  const projectRoot = nonEmpty(input.projectRoot ?? process.env.PROJECT_ROOT)
  if (projectRoot) return joinDataUploads(projectRoot)

  return resolveRepoDataUploads(input.cwd ?? process.cwd())
}
