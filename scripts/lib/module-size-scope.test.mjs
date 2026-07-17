import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  listModuleSourcePaths,
  MODULE_SIZE_SOFT_CEILING,
  scanModuleSizes,
  scanModuleSizesSync,
} from "./module-size-scope.mjs";

async function fixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "module-size-scope-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("scans the canonical module-size scope and tolerates absent optional roots", async () => {
  await fixture({
    "apps/web/a.ts": "one\ntwo\n",
    "apps/web/a.test.ts": "one\n",
    "apps/web/__snapshots__/ignored.ts": "ignored\n",
    "apps/web/data.bin": Buffer.from([0, 255]),
    "packages/db/src/seed-extra.ts": "ignored\n",
  }, async (repoRoot) => {
    assert.equal(MODULE_SIZE_SOFT_CEILING, 800);
    const expected = {
      "apps/web/a.test.ts": 2,
      "apps/web/a.ts": 3,
    };
    assert.deepEqual(await scanModuleSizes({ repoRoot }), expected);
    assert.deepEqual(scanModuleSizesSync({ repoRoot }), expected);
  });
});

test("bounds source reads", async () => {
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
    `apps/web/file-${index}.ts`, "export {};\n",
  ]));
  await fixture(files, async (repoRoot) => {
    let active = 0;
    let maximum = 0;
    const readFile = async (...args) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const { readFile: nativeReadFile } = await import("node:fs/promises");
      const value = await nativeReadFile(...args);
      active -= 1;
      return value;
    };
    const sizes = await scanModuleSizes({ repoRoot, readFile });
    assert.equal(Object.keys(sizes).length, 40);
    assert.ok(maximum <= 8, `maximum concurrent reads was ${maximum}`);
  });
});

test("surfaces non-ENOENT traversal errors with the failing path", async () => {
  await fixture({ "apps/web/a.ts": "export {};\n" }, async (repoRoot) => {
    const failingPath = join(repoRoot, "apps", "web");
    const injectedReaddir = async (path, options) => {
      if (path === failingPath) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return readdir(path, options);
    };
    await assert.rejects(
      listModuleSourcePaths({ repoRoot, readdir: injectedReaddir }),
      (error) => error.message.includes(failingPath) && error.cause?.code === "EACCES",
    );
  });
});

test("the synchronous legacy guard skips traversal and stat errors", async () => {
  await fixture({
    "apps/web/a.ts": "export {};\n",
    "packages/core/b.ts": "export {};\n",
  }, async (repoRoot) => {
    const blockedDirectory = join(repoRoot, "apps", "web");
    const unreadableFile = join(repoRoot, "packages", "core", "b.ts");
    const { readdirSync: nativeReaddirSync, statSync: nativeStatSync } = await import("node:fs");
    const sizes = scanModuleSizesSync({
      repoRoot,
      readdirSync: (path) => {
        if (path === blockedDirectory) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return nativeReaddirSync(path);
      },
      statSync: (path) => {
        if (path === unreadableFile) throw Object.assign(new Error("gone"), { code: "EIO" });
        return nativeStatSync(path);
      },
    });
    assert.deepEqual(sizes, {});
  });
});
