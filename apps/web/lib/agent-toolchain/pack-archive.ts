import "server-only";

// BI-52934B3E — a byte-stable gzip'd tar of the dpf-platform pack.
//
// The same tree always yields the same bytes, so `archiveSha256` in the
// manifest is a stable transport check (design §5.1): entries in digest
// order, POSIX ustar headers with mtime 0 and uid/gid 0, no directory entries,
// and a gzip header with mtime 0 and a fixed OS byte (zlib stamps the build
// platform there, which would differ between a Windows dev host and the Linux
// image). No archive dependency: ustar is a fixed 512-byte header.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BLOCK = 512;
const GZIP_OS_UNKNOWN = 0xff;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/** Split a path into ustar `prefix` (≤155) and `name` (≤100) at a `/`. */
function splitName(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/", cut - 1)) {
    const prefix = path.slice(0, cut);
    const name = path.slice(cut + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  throw new Error(`pack path too long for ustar: ${path}`);
}

function header(path: string, size: number, mode: number): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitName(path);
  block.write(name, 0, 100, "utf8");
  block.write(octal(mode, 8), 100, 8, "ascii");
  block.write(octal(0, 8), 108, 8, "ascii"); // uid
  block.write(octal(0, 8), 116, 8, "ascii"); // gid
  block.write(octal(size, 12), 124, 12, "ascii");
  block.write(octal(0, 12), 136, 12, "ascii"); // mtime
  block.fill(0x20, 148, 156); // checksum placeholder: spaces
  block.write("0", 156, 1, "ascii"); // regular file
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + " ", 148, 8, "ascii");
  return block;
}

function modeFor(path: string): number {
  return /\.(sh|py)$/.test(path) ? 0o755 : 0o644;
}

/** Deterministic `.tar.gz` of `files` (POSIX-relative, already ordered) under `root`. */
export function buildPackArchive(root: string, files: readonly string[]): Buffer {
  const parts: Buffer[] = [];
  for (const relative of files) {
    const bytes = readFileSync(join(root, ...relative.split("/")));
    parts.push(header(relative, bytes.length, modeFor(relative)), bytes);
    const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive marker
  const gz = gzipSync(Buffer.concat(parts), { level: 9 });
  gz.writeUInt32LE(0, 4); // MTIME
  gz[9] = GZIP_OS_UNKNOWN;
  return gz;
}
