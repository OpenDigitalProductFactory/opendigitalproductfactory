import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"));

test("schema-v1 manifest declares the complete pre-drain contract", async () => {
  const schema = JSON.parse(await readFile(resolve(root, "promoter-contract.schema.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(root, "promoter-contract.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.callerProtocol, { min: 1, max: 1 });
  assert.equal(manifest.entrypoint, "/promoter/promote.sh");
  assert.deepEqual(manifest.requiredMounts, [
    { path: "/var/run/docker.sock", mode: "rw" },
    { path: "/host-source", mode: "ro" },
    { path: "/dpf-state", mode: "rw" },
  ]);
  assert.ok(manifest.requiredFiles.includes("/app/promoter-contract.json"));
});

test("promoter image embeds and labels the exact contract", async () => {
  const [dockerfile, bytes] = await Promise.all([
    readFile(resolve(root, "Dockerfile.promoter"), "utf8"),
    readFile(resolve(root, "promoter-contract.json")),
  ]);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.match(dockerfile, /COPY promoter-contract\.json \/app\/promoter-contract\.json/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_SOURCE_SHA/);
  assert.match(dockerfile, /ARG DPF_PROMOTER_CONTRACT_DIGEST/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{DPF_PROMOTER_SOURCE_SHA\}"/);
  assert.match(dockerfile, /org\.opendpf\.promoter\.contract-schema="1"/);
  assert.match(dockerfile, /org\.opendpf\.promoter\.contract-digest="\$\{DPF_PROMOTER_CONTRACT_DIGEST\}"/);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
});
