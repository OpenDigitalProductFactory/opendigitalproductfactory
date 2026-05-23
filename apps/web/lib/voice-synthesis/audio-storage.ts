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
  // CodeQL #111 (js/insecure-temporary-file): the original used
  // `${process.pid}.tmp` — predictable suffix in a writable directory.
  // Two changes harden this:
  //   1. randomUUID() in the suffix (122 bits of unguessable entropy)
  //   2. `.staging` extension instead of `.tmp` — the staging file lives
  //      under the operator-configured storageRoot (NOT os.tmpdir), so
  //      CodeQL's tmp-file heuristic was a misclassification. The
  //      rename remains atomic on POSIX, so readers never see a partial
  //      audio blob.
  const stagingPath  = `${absolutePath}.${randomUUID()}.staging`

  await fs.mkdir(absoluteDir, { recursive: true })
  await fs.writeFile(stagingPath, Buffer.from(input.audioBuffer))
  await fs.rename(stagingPath, absolutePath)

  return { storageKey }
}

export function audioStorageKeyToUrl(storageKey: string): string {
  return `/api/voice/audio/${storageKey}`
}
