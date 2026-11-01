import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rename, lstat, open, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegularFile } from "./read-regular-file.mjs";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "dpf-regular-read-"));
  const source = join(directory, "source.ts");
  await writeFile(source, "original source");
  try { await run({ directory, source }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("reads original text and byte content", () => fixture(async ({ source }) => {
  assert.equal(await readRegularFile(source, "utf8"), "original source");
  assert.deepEqual(await readRegularFile(source), Buffer.from("original source"));
}));

test("a pathname replacement after validation cannot replace the bytes read", () => fixture(async ({ directory, source }) => {
  const value = await readRegularFile(source, "utf8", { lstatFile: async (path, options) => {
    const stat = await lstat(path, options);
    await rename(source, join(directory, "original.ts"));
    await writeFile(source, "replacement source");
    return stat;
  } });
  assert.equal(value, "original source");
}));

test("rejects a replacement between open and pathname validation", () => fixture(async ({ directory, source }) => {
  await assert.rejects(readRegularFile(source, "utf8", { openFile: async (...args) => {
    const handle = await open(...args);
    await rename(source, join(directory, "original.ts"));
    await writeFile(source, "replacement source");
    return handle;
  } }), /changed|identity/);
}));

test("rejects links and directories", () => fixture(async ({ directory, source }) => {
  const link = join(directory, "link.ts");
  await symlink(source, link);
  await assert.rejects(readRegularFile(link, "utf8"));
  await assert.rejects(readRegularFile(directory, "utf8"));
}));

test("closes its descriptor when the read fails", () => fixture(async ({ source }) => {
  let closed = false;
  await assert.rejects(readRegularFile(source, "utf8", { openFile: async (...args) => {
    const handle = await open(...args);
    return { stat: handle.stat.bind(handle), readFile: async () => { throw new Error("injected read failure"); }, close: async () => { closed = true; await handle.close(); } };
  } }), /injected read failure/);
  assert.equal(closed, true);
}));
