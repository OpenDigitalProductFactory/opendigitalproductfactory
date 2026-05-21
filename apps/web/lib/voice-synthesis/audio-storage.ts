import * as fs from "node:fs/promises"
import * as path from "node:path"
import { randomUUID } from "node:crypto"

export interface WriteAudioBlobInput {
  interactionId: string
  audioBuffer: ArrayBuffer
  ext: string         // e.g. "mp3"
  storageRoot?: string
}

export interface WriteAudioBlobResult {
  storageKey: string  // relative path: voice/<interactionId>/<uuid>.mp3
}

function getStorageRoot(override?: string): string {
  return override ?? process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads"
}

export async function writeAudioBlob(input: WriteAudioBlobInput): Promise<WriteAudioBlobResult> {
  const storageRoot = getStorageRoot(input.storageRoot)
  const relativeDir = `voice/${input.interactionId}`
  const filename    = `${randomUUID()}.${input.ext}`
  const storageKey  = `${relativeDir}/${filename}`

  const absoluteDir  = path.join(storageRoot, relativeDir)
  const absolutePath = path.join(storageRoot, storageKey)
  const tmpPath      = `${absolutePath}.${process.pid}.tmp`

  await fs.mkdir(absoluteDir, { recursive: true })
  await fs.writeFile(tmpPath, Buffer.from(input.audioBuffer))
  await fs.rename(tmpPath, absolutePath)

  return { storageKey }
}

export function audioStorageKeyToUrl(storageKey: string): string {
  return `/api/voice/audio/${storageKey}`
}
