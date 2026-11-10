// The ustar reader for dpf-render's output (BI-3A0E5413).
//
// dpf-render writes an uncompressed POSIX ustar stream to stdout: regular files
// only, flat names, every entry dated 0. Reading that takes a few dozen lines,
// so it lives here instead of in a new package (absorb, don't adopt). Anything
// outside that narrow shape is refused rather than guessed at.

const BLOCK = 512;
const MAX_ENTRIES = 256;
const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type TarEntry = { name: string; data: Buffer };

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function octal(header: Buffer, start: number, length: number): number {
  const text = field(header, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error("not a tar archive: a numeric header field is not octal");
  return text === "" ? 0 : parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum === octal(header, 148, 8);
}

/** Every regular file in a ustar archive, in archive order. Throws on anything else. */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return entries; // end-of-archive marker
    if (!checksumOk(header)) throw new Error("not a tar archive: header checksum mismatch");
    const prefix = field(header, 345, 155);
    const name = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
    const type = String.fromCharCode(header[156] || 0x30);
    const size = octal(header, 124, 12);
    if (type !== "0") throw new Error(`tar entry ${name} is not a regular file (type ${type})`);
    if (!ENTRY_NAME.test(name)) throw new Error(`unexpected tar entry name: ${JSON.stringify(name)}`);
    const start = offset + BLOCK;
    if (start + size > archive.length) throw new Error(`tar archive is truncated inside ${name}`);
    entries.push({ name, data: Buffer.from(archive.subarray(start, start + size)) });
    if (entries.length > MAX_ENTRIES) throw new Error(`tar archive has more than ${MAX_ENTRIES} entries`);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (offset === 0) throw new Error("not a tar archive: shorter than one header");
  throw new Error("tar archive is truncated: no end-of-archive marker");
}

/** Write a ustar archive of regular files (tests, and any caller that needs the same shape). */
export function writeTar(files: Array<{ name: string; data: Buffer; type?: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(BLOCK);
    header.write(file.name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${file.data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write(file.type ?? "0", 156, 1, "ascii");
    header.write("ustar\u000000", 257, 8, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    parts.push(header, file.data, Buffer.alloc((BLOCK - (file.data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
