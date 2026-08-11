import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, "$1")), "..");
const validatorAssets = [
  "scripts/installer/validate-install-state.mjs",
  "scripts/installer/install-state-schema-registry.mjs",
  "scripts/installer/install-state.schema.json",
  "scripts/installer/install-state.v1.schema.json",
  "scripts/installer/install-state.v2.schema.json",
];

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

/** Extract the quoted entries of an exported `readonly string[]` array literal. */
function parseExportedStringArray(source, exportName) {
  const start = source.indexOf(exportName);
  assert.ok(start >= 0, `${exportName} not found`);
  // Skip the `: readonly string[]` type annotation and open at the `= [` literal.
  const eq = source.indexOf("=", start);
  const open = source.indexOf("[", eq);
  const close = source.indexOf("]", open);
  assert.ok(eq >= 0 && open >= 0 && close > open, `${exportName} array literal malformed`);
  return [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
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
  for (const asset of validatorAssets) {
    assert.ok(dockerfile.includes(`COPY ${asset} /promoter/installer/${posix.basename(asset)}`), asset);
    await access(join(root, asset));
  }
  assert.match(dockerfile, /COPY scripts\/rotate-runtime-transition-secret\.mjs \/promoter\/rotate-runtime-transition-secret\.mjs/);
});

test("portal and release images retain the validator's complete transitive asset set", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  for (const asset of validatorAssets) {
    assert.ok(dockerfile.includes(`COPY ${asset} ./scripts/installer/`), `portal build input missing ${asset}`);
    assert.ok(dockerfile.includes(`cp ${asset} /dpf-release-assets/scripts/installer/`), `release asset missing ${asset}`);
    assert.ok(dockerfile.includes(`COPY ${asset} /promoter/scripts/installer/${posix.basename(asset)}`), `JIT source missing ${asset}`);
  }
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

test("Dockerfile.promoter.dockerignore allowlist matches the promoter COPY sources exactly", async () => {
  const [promoterDockerfile, dockerignore] = await Promise.all([
    readFile(join(root, "Dockerfile.promoter"), "utf8"),
    readFile(join(root, "Dockerfile.promoter.dockerignore"), "utf8"),
  ]);
  const copySources = new Set(parseSimpleLocalCopySources(promoterDockerfile));
  const allowlisted = new Set(
    dockerignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("!"))
      .map((line) => line.slice(1).trim()),
  );
  // The context must be ignored-by-default so ONLY the allowlist is sent — this is
  // what keeps the candidate build's context off the whole repo (SUR-BF75ED2A).
  assert.match(dockerignore, /^\*\*$/m, "dockerignore must ignore ** before re-including");
  // The dockerignore also re-includes Dockerfile.promoter itself (read via -f;
  // harmless in-context). Everything else it re-includes MUST be a real COPY
  // source, and every COPY source MUST be re-included — drift either way breaks
  // the promoter build (missing file) or reintroduces the OOM (extra tree).
  allowlisted.delete("Dockerfile.promoter");
  for (const source of copySources) {
    assert.ok(allowlisted.has(source), `dockerignore must re-include COPY source ${source}`);
  }
  for (const included of allowlisted) {
    assert.ok(copySources.has(included), `dockerignore re-includes ${included}, not a Dockerfile.promoter COPY source`);
  }
});

test("shared PROMOTER_BUILD_CONTEXT_SOURCES equals Dockerfile.promoter's local COPY sources exactly", async () => {
  const [promoterDockerfile, contextSource] = await Promise.all([
    readFile(join(root, "Dockerfile.promoter"), "utf8"),
    readFile(join(root, "apps", "web", "lib", "self-upgrade", "promoter-build-context.ts"), "utf8"),
  ]);
  const copySources = parseSimpleLocalCopySources(promoterDockerfile);
  const shared = parseExportedStringArray(contextSource, "PROMOTER_BUILD_CONTEXT_SOURCES");

  assert.ok(shared.length > 0, "PROMOTER_BUILD_CONTEXT_SOURCES must not be empty");
  assert.deepEqual(
    [...shared].sort(),
    [...copySources].sort(),
    "the shared build-context source-of-truth must match Dockerfile.promoter's COPY sources exactly (no drift)",
  );
  // The Dockerfile that builds the image is not a COPY source but must also be
  // staged so `-f <ctx>/Dockerfile.promoter` resolves inside the minimal context.
  assert.ok(
    /PROMOTER_DOCKERFILE\s*=\s*"Dockerfile\.promoter"/.test(contextSource),
    "PROMOTER_DOCKERFILE must be the Dockerfile.promoter filename",
  );
  assert.ok(
    /PROMOTER_BUILD_CONTEXT_FILES[\s\S]*\.\.\.PROMOTER_BUILD_CONTEXT_SOURCES[\s\S]*PROMOTER_DOCKERFILE/.test(contextSource),
    "PROMOTER_BUILD_CONTEXT_FILES must stage every COPY source plus the Dockerfile",
  );
});

test("candidate promoter build stages exactly the COPY sources, never the whole workspace", async () => {
  const artifactSource = await readFile(
    join(root, "apps", "web", "lib", "self-upgrade", "promoter-artifact.ts"),
    "utf8",
  );

  // It must derive its context from the shared source-of-truth staging helper…
  assert.ok(
    /import\s*\{[\s\S]*stageMinimalPromoterBuildContext[\s\S]*\}\s*from\s*"\.\/promoter-build-context"/.test(artifactSource),
    "candidate build must import the shared staging helper",
  );
  assert.ok(
    artifactSource.includes("stageMinimalPromoterBuildContext(params.sourcePath)"),
    "candidate build must stage the minimal context from the target-sha sourcePath",
  );
  assert.ok(
    /rm\(contextDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/.test(artifactSource),
    "candidate build must clean up the staged context directory",
  );

  // …and the docker build must use that staged directory as its context, never
  // the raw whole-tree sourcePath (the readdirent OOM that bricked SUR-BF75ED2A).
  const buildCall = /"buildx",\s*"build",\s*"--load",([\s\S]*?)\]\)/.exec(artifactSource);
  assert.ok(buildCall, "candidate build must issue a buildx build invocation");
  const buildArgs = buildCall[1];
  assert.ok(
    buildArgs.includes("contextDir,"),
    "candidate build context must be the staged contextDir",
  );
  assert.ok(
    buildArgs.includes("join(contextDir, PROMOTER_DOCKERFILE)"),
    "candidate build -f must resolve inside the staged context",
  );
  assert.ok(
    !buildArgs.includes("params.sourcePath"),
    "candidate build must NOT pass the whole workspace sourcePath as the docker context",
  );
});
