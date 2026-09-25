// Test-time OpenDocument packages (BI-BFF142A1): a real ZIP with the leading
// stored `mimetype` entry, a META-INF/manifest.xml and whatever parts a test
// names, so no binary office fixture is committed.

import { crc32, deflateRawSync } from "node:zlib";

export type PackagePart = { path: string; data: string | Buffer; mediaType?: string };

function entry(name: string, data: Buffer, deflate: boolean, offset: number) {
  const nameBytes = Buffer.from(name, "utf8");
  const body = deflate ? deflateRawSync(data) : data;
  const method = deflate ? 8 : 0;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(offset, 42);
  return { local: Buffer.concat([local, nameBytes, body]), central: Buffer.concat([central, nameBytes]) };
}

/** A ZIP of the given entries, in order; `deflate` compresses every entry but the first. */
export function zipPackage(entries: Array<{ name: string; data: Buffer }>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  entries.forEach(({ name, data }, index) => {
    const built = entry(name, data, deflate && index > 0, offset);
    locals.push(built.local);
    centrals.push(built.central);
    offset += built.local.length;
  });
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** An OpenDocument package of `flavor` whose manifest lists `parts` (each with its media type). */
export function odfPackage(
  flavor: "text" | "spreadsheet" | "presentation",
  parts: PackagePart[] = [],
  options: { deflate?: boolean; manifest?: boolean } = {},
): Buffer {
  const mimetype = `application/vnd.oasis.opendocument.${flavor}`;
  const listed = [{ path: "/", mediaType: mimetype }, { path: "content.xml", mediaType: "text/xml" }, ...parts];
  const manifest = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">',
    ...listed.map((part) => ` <manifest:file-entry manifest:full-path="${part.path}" manifest:media-type="${part.mediaType ?? ""}"/>`),
    "</manifest:manifest>",
  ].join("\n");
  const files = [
    { name: "mimetype", data: Buffer.from(mimetype, "latin1") },
    { name: "content.xml", data: Buffer.from('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>') },
    ...parts.filter((part) => !part.path.endsWith("/")).map((part) => ({ name: part.path, data: Buffer.from(part.data) })),
    ...(options.manifest === false ? [] : [{ name: "META-INF/manifest.xml", data: Buffer.from(manifest, "utf8") }]),
  ];
  return zipPackage(files, options.deflate ?? true);
}

/** An embedded chart sub-document, as office suites write one ("Object 1/"). */
export const CHART_OBJECT_PARTS: PackagePart[] = [
  { path: "Object 1/", data: "", mediaType: "application/vnd.oasis.opendocument.chart" },
  { path: "Object 1/content.xml", data: "<office:document-content/>", mediaType: "text/xml" },
  { path: "ObjectReplacements/Object 1", data: "svm", mediaType: "application/x-openoffice-gdimetafile;windows_formatname=&quot;GDIMetaFile&quot;" },
];
