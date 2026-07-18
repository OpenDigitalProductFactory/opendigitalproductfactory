import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, "$1")), "..");

function parseSimpleLocalCopySources(dockerfile) {
  const instructions = dockerfile
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^COPY(?:\s|$)/i.test(line));

  return instructions.map((instruction) => {
    const match = /^COPY\s+(\S+)\s+(\S+)$/i.exec(instruction);
    assert.ok(
      match && !match[1].startsWith("--"),
      `unsupported Dockerfile.promoter COPY form: ${instruction}`,
    );
    return match[1];
  });
}

test("promoter COPY parser fails closed on forms the contract does not support", () => {
  assert.throws(
    () => parseSimpleLocalCopySources('COPY ["one", "two", "/dest/"]'),
    /unsupported Dockerfile\.promoter COPY form/,
  );
  assert.throws(
    () => parseSimpleLocalCopySources("COPY --chmod=755 one /dest/"),
    /unsupported Dockerfile\.promoter COPY form/,
  );
});

test("promoter image contains the install-state validator at its import-resolved paths", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile.promoter"), "utf8");
  assert.match(dockerfile, /COPY scripts\/installer\/validate-install-state\.mjs \/promoter\/installer\/validate-install-state\.mjs/);
  assert.match(dockerfile, /COPY scripts\/installer\/install-state\.schema\.json \/promoter\/installer\/install-state\.schema\.json/);
  assert.match(dockerfile, /COPY scripts\/rotate-runtime-transition-secret\.mjs \/promoter\/rotate-runtime-transition-secret\.mjs/);
  await access(join(root, "scripts", "installer", "validate-install-state.mjs"));
  await access(join(root, "scripts", "installer", "install-state.schema.json"));
});

test("portal-baked JIT context includes every local Dockerfile.promoter COPY source", async () => {
  const [promoterDockerfile, portalDockerfile, promoterSource] = await Promise.all([
    readFile(join(root, "Dockerfile.promoter"), "utf8"),
    readFile(join(root, "Dockerfile"), "utf8"),
    readFile(join(root, "apps", "web", "lib", "self-upgrade", "promoter.ts"), "utf8"),
  ]);
  const localCopySources = parseSimpleLocalCopySources(promoterDockerfile);
  const portalDockerfileLines = new Set(portalDockerfile.split(/\r?\n/).map((line) => line.trim()));
  const jitScriptSource = promoterSource.replaceAll('\\"', '"');

  assert.ok(localCopySources.length > 0, "Dockerfile.promoter must have local COPY inputs");
  for (const source of localCopySources) {
    const parent = posix.dirname(source);
    assert.ok(
      portalDockerfileLines.has(`COPY ${source} /promoter/${source}`),
      `portal image must bake ${source} at its context-relative path`,
    );
    if (parent !== ".") {
      assert.ok(
        jitScriptSource.includes(`mkdir -p "$BDIR/${parent}"`),
        `JIT build must create ${parent}`,
      );
    }
    assert.ok(
      jitScriptSource.includes(`cp /promoter/${source} "$BDIR/${source}"`),
      `JIT build must stage ${source} at its context-relative path`,
    );
  }
  assert.ok(
    jitScriptSource.includes(`trap 'rm -rf "$BDIR"' EXIT`),
    "JIT build must clean up its temp directory on success and failure",
  );
});
