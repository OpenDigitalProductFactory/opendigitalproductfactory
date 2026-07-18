import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release image manifest verification renders services behind profiles", async () => {
  const source = await readFile(new URL("./verify-compose-image-manifests.mjs", import.meta.url), "utf8");
  assert.match(source, /args\.push\("--profile", "\*", "config", "--images"\)/);
});
