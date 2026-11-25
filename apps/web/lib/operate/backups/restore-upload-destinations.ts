import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { RestoreFileIntent, RestoreJournalIntent } from "./paired-restore-journal";

export type RestoreUploadRoot = RestoreJournalIntent["receiver"][number];
export type RestoreUploadMember = { root: string; path: string; sha256: string };
export type RestoreUploadInspection = {
  entries: Array<RestoreUploadMember & { observedSha256: string | null }>;
  collisionSetSha256: string;
};

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const digest = /^[0-9a-f]{64}$/;

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function fdPath(dir: FileHandle, part: string) {
  return join("/proc/self/fd", String(dir.fd), part);
}

/** Linux portal only. Pin each directory without following links through mutable parents. */
async function openRoot(path: string): Promise<FileHandle> {
  if (process.platform !== "linux") throw new Error("Managed upload restore requires the Linux portal filesystem");
  if (!isAbsolute(path) || path === sep || resolve(path) !== path || await realpath(path) !== path) {
    throw new Error("Receiving upload root must be an absolute physical directory");
  }
  let handle = await open(sep, DIRECTORY_FLAGS);
  try {
    for (const part of path.slice(1).split(sep)) {
      const next = await open(fdPath(handle, part), DIRECTORY_FLAGS);
      await handle.close();
      handle = next;
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function ensureDisjoint(roots: RestoreUploadRoot[]): void {
  if (!roots.length || roots.some((a, index) => roots.slice(index + 1).some((b) => a.name === b.name
    || (a.dev === b.dev && a.ino === b.ino) || a.path === b.path || a.path.startsWith(b.path + sep) || b.path.startsWith(a.path + sep)))) {
    throw new Error("Missing, duplicate, or overlapping receiving upload root");
  }
}

export async function captureRestoreUploadRoots(
  roots: ReadonlyArray<Pick<RestoreUploadRoot, "name" | "path">>,
): Promise<RestoreUploadRoot[]> {
  const captured: RestoreUploadRoot[] = [];
  for (const root of roots) {
    if (!/^[a-z0-9-]+$/.test(root.name)) throw new Error("Unknown receiving upload root name");
    const handle = await openRoot(root.path);
    try {
      const stat = await handle.stat({ bigint: true });
      captured.push({ ...root, dev: String(stat.dev), ino: String(stat.ino) });
    } finally {
      await handle.close();
    }
  }
  ensureDisjoint(captured);
  return captured.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
}

function partsFor(member: RestoreUploadMember): string[] {
  const parts = member.path.split("/");
  if (!digest.test(member.sha256) || /[\u0000\p{Cs}]/u.test(member.path)
    || parts.some((part) => part === "." || part === ".." || part === "")) {
    throw new Error("Invalid logical upload destination");
  }
  return parts;
}

async function openCurrentRoot(root: RestoreUploadRoot): Promise<FileHandle> {
  const handle = await openRoot(root.path);
  try {
    const now = await handle.stat({ bigint: true });
    if (String(now.dev) !== root.dev || String(now.ino) !== root.ino) throw new Error("Receiving upload root identity changed");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function inspectOne(
  root: FileHandle, dev: string, parts: string[],
  onParent?: (identity: string, depth: number) => void,
): Promise<{ sha256: string; inode: string } | null> {
  let dir = root;
  try {
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const part = parts[depth]!;
      const next = await open(fdPath(dir, part), DIRECTORY_FLAGS);
      if (dir !== root) await dir.close();
      dir = next;
      const stat = await dir.stat({ bigint: true });
      if (String(stat.dev) !== dev) throw new Error("Upload destination crosses a filesystem boundary");
      onParent?.(`${stat.dev}:${stat.ino}`, depth + 1);
    }
    const file = await open(fdPath(dir, parts[parts.length - 1]!), FILE_FLAGS);
    try {
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n || String(stat.dev) !== dev) {
        throw new Error("An existing upload destination must be a single-link regular file on the receiving filesystem");
      }
      const hash = createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
      const after = await file.stat({ bigint: true });
      if (after.nlink !== 1n || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) {
        throw new Error("An existing upload destination changed during inspection");
      }
      return { sha256: hash.digest("hex"), inode: `${stat.dev}:${stat.ino}` };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  } finally {
    if (dir !== root) await dir.close();
  }
}

export async function inspectRestoreUploadDestinations(
  roots: RestoreUploadRoot[],
  members: Iterable<RestoreUploadMember> | AsyncIterable<RestoreUploadMember>,
): Promise<RestoreUploadInspection> {
  ensureDisjoint(roots);
  const handles = new Map<string, { fd: FileHandle; dev: string }>();
  const entries: RestoreUploadInspection["entries"] = [];
  const filePaths = new Set<string>();
  const ancestors = new Map<string, string>();
  const physicalParents = new Map(roots.map(({ name, dev, ino }) => [`${dev}:${ino}`, JSON.stringify([name])]));
  const existingInodes = new Set<string>();
  try {
    for (const root of roots) {
      const fd = await openCurrentRoot(root);
      handles.set(root.name, { fd, dev: root.dev });
    }
    for await (const member of members) {
      const root = handles.get(member.root);
      if (!root) throw new Error("Unknown receiving root in verified upload archive");
      const parts = partsFor(member);
      // A physical alias is never admissible. Reject case/normalization
      // ambiguity even when none of those destination names exists yet.
      const logical = [member.root, ...parts];
      for (let depth = 1; depth < logical.length; depth++) {
        const actual = JSON.stringify(logical.slice(0, depth + 1));
        const alias = JSON.stringify(logical.slice(0, depth + 1).map((value) => value.normalize("NFC").toLowerCase()));
        const prior = ancestors.get(alias);
        const leaf = depth === parts.length;
        if (filePaths.has(alias) || (prior !== undefined && (prior !== actual || leaf))) {
          throw new Error("Upload archive destinations have a path alias");
        }
        ancestors.set(alias, actual);
        if (leaf) filePaths.add(alias);
      }
      const existing = await inspectOne(root.fd, root.dev, parts, (identity, depth) => {
        const here = JSON.stringify(logical.slice(0, depth + 1));
        const previous = physicalParents.get(identity);
        if (previous !== undefined && previous !== here) throw new Error("Upload archive destinations have a physical directory alias");
        physicalParents.set(identity, here);
      });
      if (existing && existingInodes.has(existing.inode)) throw new Error("Upload archive destinations have a physical file alias");
      if (existing) existingInodes.add(existing.inode);
      entries.push({ root: member.root, path: member.path, sha256: member.sha256, observedSha256: existing?.sha256 ?? null });
    }
  } finally {
    await Promise.all([...handles.values()].map(({ fd }) => fd.close()));
  }
  entries.sort(compareDestinations);
  return { entries, collisionSetSha256: digestUploadDestinationInspection(entries) };
}

function compareDestinations(a: RestoreUploadMember, b: RestoreUploadMember) {
  return Buffer.compare(Buffer.from(a.root), Buffer.from(b.root)) || Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
}

export function digestUploadDestinationInspection(entries: RestoreUploadInspection["entries"]): string {
  const sorted = [...entries].sort(compareDestinations);
  const hash = createHash("sha256");
  for (const { root, path, sha256, observedSha256 } of sorted) hash.update(JSON.stringify([root, path, sha256, observedSha256]) + "\n");
  return hash.digest("hex");
}

export function assertCoveredUploadCollisions(preview: RestoreUploadInspection, verifiedSafetyMembers: Iterable<RestoreUploadMember>): void {
  const needed = new Map(preview.entries.filter(({ observedSha256, sha256 }) => observedSha256 !== null && observedSha256 !== sha256)
    .map(({ root, path, observedSha256 }) => [JSON.stringify([root, path]), observedSha256]));
  for (const member of verifiedSafetyMembers) {
    const key = JSON.stringify([member.root, member.path]);
    if (needed.get(key) === member.sha256) needed.delete(key);
  }
  if (needed.size) throw new Error("A different destination file is not covered by the verified safety upload pair");
}

async function openPublicationParent(root: FileHandle, dev: string, parts: string[], create: boolean): Promise<FileHandle> {
  let current = root;
  try {
    for (const part of parts) {
      const path = fdPath(current, part);
      let next;
      try { next = await open(path, DIRECTORY_FLAGS); } catch (error) {
        if (!missing(error) || !create) throw error;
        try { await mkdir(path, { mode: 0o755 }); } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        await current.sync();
        next = await open(path, DIRECTORY_FLAGS);
      }
      if (current !== root) await current.close();
      current = next;
      if (String((await current.stat({ bigint: true })).dev) !== dev) throw new Error("Upload destination crosses a filesystem boundary");
    }
    return current;
  } catch (error) {
    if (current !== root) await current.close();
    throw error;
  }
}

type StagedUploadBytes = { sizeBytes: number; content: AsyncIterable<Uint8Array> };

async function writeVerifiedStagingFile(file: FileHandle, expected: string, bytes: StagedUploadBytes): Promise<void> {
  const hash = createHash("sha256");
  let total = 0;
  for await (const chunk of bytes.content) {
    total += chunk.byteLength;
    if (total > bytes.sizeBytes) throw new Error("Staged upload exceeds the verified size");
    hash.update(chunk);
    for (let offset = 0; offset < chunk.byteLength;) {
      const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
      if (!bytesWritten) throw new Error("Staged upload write made no progress");
      offset += bytesWritten;
    }
  }
  if (total !== bytes.sizeBytes || hash.digest("hex") !== expected) throw new Error("Staged upload digest or size changed");
  await file.sync();
}

/** Called only after whole-archive verification, writer fencing and durable per-file intent. */
export async function publishRestoreUploadFile(
  root: RestoreUploadRoot,
  intent: RestoreFileIntent,
  bytes?: StagedUploadBytes,
): Promise<string | null> {
  const { beforeSha256, afterSha256 } = intent;
  if (root.name !== intent.rootName || beforeSha256 === afterSha256
    || (beforeSha256 !== null && !digest.test(beforeSha256)) || (afterSha256 !== null && !digest.test(afterSha256))) {
    throw new Error("Upload publication does not match the exact verified intent");
  }
  const parts = partsFor({ root: intent.rootName, path: intent.relativePath, sha256: (afterSha256 ?? beforeSha256)! });
  const rootFd = await openCurrentRoot(root);
  try {
    const observed = (await inspectOne(rootFd, root.dev, parts))?.sha256 ?? null;
    if (observed === afterSha256) {
      // A prior execution may have renamed or removed the file, but died
      // before the parent directory sync or the durable publication receipt.
      let parent;
      try { parent = await openPublicationParent(rootFd, root.dev, parts.slice(0, -1), false); } catch (error) {
        if (missing(error) && afterSha256 === null) return null;
        throw error;
      }
      try { await parent.sync(); } finally { if (parent !== rootFd) await parent.close(); }
      return observed;
    }
    if (observed !== beforeSha256) throw new Error("Upload destination changed since its approved inspection");
    if (afterSha256 !== null && (!bytes || !Number.isSafeInteger(bytes.sizeBytes) || bytes.sizeBytes < 0)) {
      throw new Error("Upload publication requires verified staging bytes");
    }
    const parent = await openPublicationParent(rootFd, root.dev, parts.slice(0, -1), afterSha256 !== null);
    const name = parts[parts.length - 1]!;
    const destination = fdPath(parent, name);
    // This name is covered by the existing writer's transient-file policy.
    const temporary = fdPath(parent, `.dpf-restore.${process.pid}.${randomUUID()}.tmp`);
    let staged = false;
    try {
      if (afterSha256 !== null) {
        const file = await open(temporary, "wx", 0o600);
        staged = true;
        try { await writeVerifiedStagingFile(file, afterSha256, bytes!); } finally { await file.close(); }
      }
      if (((await inspectOne(parent, root.dev, [name]))?.sha256 ?? null) !== beforeSha256) {
        throw new Error("Upload destination changed during staging");
      }
      if (afterSha256 === null) await unlink(destination);
      else {
        await rename(temporary, destination);
        staged = false;
      }
      await parent.sync();
      const verified = (await inspectOne(parent, root.dev, [name]))?.sha256 ?? null;
      if (verified !== afterSha256) throw new Error("Published upload bytes do not match the verified digest");
      return verified;
    } finally {
      try {
        if (staged) await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; });
      } finally {
        if (parent !== rootFd) await parent.close();
      }
    }
  } finally {
    await rootFd.close();
  }
}
