import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, "$1")), "..");

test("promoter image contains the install-state validator at its import-resolved paths", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile.promoter"), "utf8");
  assert.match(dockerfile, /COPY scripts\/installer\/validate-install-state\.mjs \/promoter\/installer\/validate-install-state\.mjs/);
  assert.match(dockerfile, /COPY scripts\/installer\/install-state\.schema\.json \/promoter\/installer\/install-state\.schema\.json/);
  await access(join(root, "scripts", "installer", "validate-install-state.mjs"));
  await access(join(root, "scripts", "installer", "install-state.schema.json"));
});
