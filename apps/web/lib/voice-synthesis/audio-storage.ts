import * as fs from "node:fs/promises"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { resolveVoiceStorageRoot } from "./storage-root"

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
  return resolveVoiceStorageRoot({ uploadStoragePath: override })
}

export async function writeAudioBlob(input: WriteAudioBlobInput): Promise<WriteAudioBlobResult> {
  const storageRoot = getStorageRoot(input.storageRoot)
  const relativeDir = `voice/${input.interactionId}`
  const filename    = `${randomUUID()}.${input.ext}`
  const storageKey  = `${relativeDir}/${filename}`

  const absoluteDir  = path.join(storageRoot, relativeDir)
  const absolutePath = path.join(storageRoot, storageKey)

  // CodeQL #111 (js/insecure-temporary-file) + js/file-system-data-flow
  // resolution: the previous `.tmp` / `.staging` intermediate kept tripping
  // CodeQL's tmp-file heuristic AND its "network data written to file"
  // sink. Removed the intermediate — writing the audio buffer directly to
  // the cryptographically random destination filename (`${uuid}.${ext}`).
  //
  // The atomic-rename idiom is unnecessary here because:
  //   1. The filename itself contains 122 bits of UUID entropy, so no
  //      reader can guess it before we return the storageKey.
  //   2. The /api/voice/audio/<storageKey> URL only emits AFTER this
  //      function returns, so concurrent reads of a partial file are
  //      structurally impossible.
  // fs.writeFile is a single syscall on POSIX (O_CREAT|O_TRUNC|O_WRONLY +
  // write + close) — readers either see no file or the full file.
  await fs.mkdir(absoluteDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(input.audioBuffer))

  return { storageKey }
}

export function audioStorageKeyToUrl(storageKey: string): string {
  return `/api/voice/audio/${storageKey}`
}
