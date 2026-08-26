import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readPromoterBuildContextSources } from "./lib/promoter-build-context-sources.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"));

test("schema-v1 manifest declares the complete pre-drain contract", async () => {
  const schema = JSON.parse(await readFile(resolve(root, "promoter-contract.schema.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(root, "promoter-contract.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.readinessProtocolFloorSha, "21969d012ad8ab382d47a2c59ffc955530796bd2");
  assert.equal(schema.properties.readinessProtocolFloorSha.const, manifest.readinessProtocolFloorSha);
  assert.deepEqual(manifest.callerProtocol, { min: 1, max: 1 });
  assert.equal(manifest.entrypoint, "/promoter/promote.sh");
  assert.deepEqual(manifest.requiredMounts, [
    { path: "/var/run/docker.sock", mode: "rw" },
    { path: "/host-source", mode: "ro" },
    { path: "/dpf-state", mode: "rw" },
  ]);
  assert.ok(manifest.requiredFiles.includes("/app/promoter-contract.json"));
  assert.ok(manifest.requiredFiles.includes("/promoter/installer/install-state-transaction.mjs"));
  assert.ok(manifest.requiredFiles.includes("/promoter/installer/install-state-lock-contract.json"));
});

test("promoter image embeds and labels the exact contract", async () => {
  const [dockerfile, bytes] = await Promise.all([
    readFile(resolve(root, "Dockerfile.promoter"), "utf8"),
    readFile(resolve(root, "promoter-contract.json")),
  ]);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.match(dockerfile, /COPY promoter-contract\.json \/app\/promoter-contract\.json/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_SOURCE_SHA/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_RELEASE_TAG/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_RELEASE_OWNER/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_CONTRACT_DIGEST/);
  assert.match(dockerfile, /ENV DPF_CANDIDATE_SOURCE_SHA="\$\{DPF_PROMOTER_SOURCE_SHA\}"/);
  assert.match(dockerfile, /DPF_CANDIDATE_RELEASE_TAG="\$\{DPF_PROMOTER_RELEASE_TAG\}"/);
  assert.match(dockerfile, /DPF_CANDIDATE_RELEASE_OWNER="\$\{DPF_PROMOTER_RELEASE_OWNER\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{DPF_PROMOTER_SOURCE_SHA\}"/);
  assert.match(dockerfile, /org\.opendpf\.promoter\.contract-schema="1"/);
  assert.match(dockerfile, /org\.opendpf\.promoter\.contract-digest="\$\{DPF_PROMOTER_CONTRACT_DIGEST\}"/);
  assert.match(dockerfile, /apk add --no-cache .*docker-cli-buildx.*docker-cli-compose/);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
});

test("portal-owned candidate builds have Buildx and cannot fall back to the legacy builder", async () => {
  const [portalDockerfile, artifactSource, promoterSource] = await Promise.all([
    readFile(resolve(root, "Dockerfile"), "utf8"),
    readFile(resolve(root, "apps/web/lib/self-upgrade/promoter-artifact.ts"), "utf8"),
    readFile(resolve(root, "apps/web/lib/self-upgrade/promoter.ts"), "utf8"),
  ]);
  assert.match(
    portalDockerfile,
    /apk add --no-cache .*docker-cli.*docker-cli-buildx.*docker-cli-compose/,
    "the portal invokes candidate builds and must carry the Buildx CLI component",
  );
  assert.match(
    artifactSource,
    /"buildx",\s*"build",\s*"--load"/,
    "candidate artifacts must explicitly use Buildx and load the image for digest inspection",
  );
  assert.match(
    promoterSource,
    /docker buildx build --load -t dpf-promoter/,
    "the portal-baked JIT recovery path must use the same explicit Buildx contract",
  );
  assert.doesNotMatch(
    promoterSource,
    /timeoutMs:\s*5\s*\*\s*60_000/,
    "candidate Docker operations must not use a separate five-minute wall clock",
  );
});

test("every staged promoter input is mechanically closed by portal baking and JIT staging", async () => {
  const [portalDockerfile, promoterSource, sources] = await Promise.all([
    readFile(resolve(root, "Dockerfile"), "utf8"),
    readFile(resolve(root, "apps/web/lib/self-upgrade/promoter.ts"), "utf8"),
    readPromoterBuildContextSources(root),
  ]);
  for (const source of sources) {
    const baked = source === "promoter-contract.json" ? "/promoter/promoter-contract.json" : `/promoter/${source}`;
    assert.match(portalDockerfile, new RegExp(`^COPY\\s+${escapeRegex(source)}\\s+${escapeRegex(baked)}$`, "m"), `portal image does not bake ${source}`);
    assert.ok(promoterSource.includes(`cp ${baked} \\\"$BDIR/${source}\\\"`), `JIT recipe does not stage ${source}`);
  }
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
