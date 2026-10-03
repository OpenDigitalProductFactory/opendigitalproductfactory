import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGitWebhookSecret, ensureGppPermitSecret, ensureInngestKeys, installReleaseAssets, updateEnv } from "./install-release-assets.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dpf-release-assets-"));
  const source = join(root, "source");
  const install = join(root, "install");
  const statePath = join(root, "state", "install-state.json");
  const hostInstallPath = process.platform === "win32" ? "D:\\DPF" : "/opt/dpf";
  await mkdir(join(source, "scripts"), { recursive: true });
  await mkdir(join(install, "scripts"), { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(join(source, "docker-compose.yml"), "new-compose\n");
  await writeFile(join(source, "scripts", "new.mjs"), "new-script\n");
  await writeFile(join(source, "SHA256SUMS"), [
    `${digest("new-compose\n")}  ./docker-compose.yml`,
    `${digest("new-script\n")}  ./scripts/new.mjs`,
  ].join("\n") + "\n");
  await writeFile(join(install, "old-managed.txt"), "old\n");
  await writeFile(join(install, "operator-owned.txt"), "keep\n");
  await writeFile(join(install, ".verified-release-assets.sha256"), `${digest("old\n")}  ./old-managed.txt\n`);
  await writeFile(join(install, ".verified-release-assets-version"), "v1.0.0");
  await writeFile(join(install, ".env"), "CUSTOM_SETTING=kept\nDPF_IMAGE_TAG=v1.0.0\nGHCR_OWNER=old-owner\n");
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 2,
    installerVersion: "v1.0.0",
    lastSuccessfulInstallVersion: "v1.0.0",
    platform: "linux",
    arch: "amd64",
    enabledRuntimeCapabilities: ["runtime:core"],
    capabilityCatalogHash: "a".repeat(64),
    capabilityStateVersion: "b".repeat(64),
    installPath: hostInstallPath,
    installMode: "consumer",
    composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
    imageTag: "v1.0.0",
  }) + "\n");
  return { root, source, install, statePath, hostInstallPath };
}

test("verified release assets replace only managed files and converge durable identity", async () => {
  const f = await fixture();
  await installReleaseAssets({
    sourceDir: f.source,
    installDir: f.install,
    statePath: f.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "opendigitalproductfactory",
    recoveryDir: join(f.root, "recovery"),
  });

  await assert.rejects(readFile(join(f.install, "old-managed.txt")), /ENOENT/);
  assert.equal(await readFile(join(f.install, "operator-owned.txt"), "utf8"), "keep\n");
  assert.equal(await readFile(join(f.install, "docker-compose.yml"), "utf8"), "new-compose\n");
  const env = await readFile(join(f.install, ".env"), "utf8");
  assert.match(env, /^CUSTOM_SETTING=kept$/m);
  assert.match(env, /^DPF_IMAGE_TAG=v2\.0\.0$/m);
  assert.match(env, /^GHCR_OWNER=opendigitalproductfactory$/m);
  // The fixture .env predates the bind key, so the upgrade keeps its exposure.
  assert.match(env, /^DPF_HOST_BIND_ADDRESS=0\.0\.0\.0$/m);
  assert.equal(await readFile(join(f.install, ".verified-release-assets-version"), "utf8"), "v2.0.0");
  await assert.rejects(readFile(join(f.source, ".env")), /ENOENT/);
  await assert.rejects(readFile(join(f.source, ".verified-release-assets-version")), /ENOENT/);
  assert.equal(await readFile(join(f.source, "docker-compose.yml"), "utf8"), "new-compose\n");
  const state = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(state.imageTag, "v2.0.0");
  assert.equal(state.installerVersion, "v2.0.0");
  assert.equal(state.lastSuccessfulInstallVersion, "v2.0.0");
  assert.equal(state.installPath, f.hostInstallPath);
  assert.equal(state.installMode, "consumer");
});

test("rejects tampering and rolls back files, env, markers, and state on injected failure", async () => {
  const tampered = await fixture();
  await writeFile(join(tampered.source, "docker-compose.yml"), "tampered\n");
  await assert.rejects(installReleaseAssets({
    sourceDir: tampered.source,
    installDir: tampered.install,
    statePath: tampered.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "owner",
    recoveryDir: join(tampered.root, "recovery"),
  }), /release_asset_integrity_failed/);

  const rollback = await fixture();
  const priorState = await readFile(rollback.statePath, "utf8");
  await assert.rejects(installReleaseAssets({
    sourceDir: rollback.source,
    installDir: rollback.install,
    statePath: rollback.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "owner",
    recoveryDir: join(rollback.root, "recovery"),
    failAfter: "files",
  }), /injected_failure:files/);
  assert.equal(await readFile(join(rollback.install, "old-managed.txt"), "utf8"), "old\n");
  await assert.rejects(readFile(join(rollback.install, "scripts", "new.mjs")), /ENOENT/);
  assert.match(await readFile(join(rollback.install, ".env"), "utf8"), /^DPF_IMAGE_TAG=v1\.0\.0$/m);
  assert.equal(await readFile(rollback.statePath, "utf8"), priorState);
});

test("release promotion commits identity to the canonical install root, not the source carrier", async () => {
  const source = await readFile(new URL("../promote.sh", import.meta.url), "utf8");
  assert.match(source, /--install\s+"\$PROMOTE_INSTALL_ROOT"/);
  assert.doesNotMatch(source, /--install\s+"\$PROMOTE_SOURCE"/);
});

test("updateEnv gives a fresh install loopback and a pre-existing install its current all-interfaces exposure (BI-FEE77B68)", () => {
  const fresh = updateEnv(null, "v2.0.0", "opendigitalproductfactory").toString("utf8");
  assert.match(fresh, /^DPF_HOST_BIND_ADDRESS=127\.0\.0\.1$/m);
  assert.match(fresh, /Loopback by default/);

  const upgraded = updateEnv(Buffer.from("DPF_IMAGE_TAG=v1.0.0\n"), "v2.0.0", "opendigitalproductfactory").toString("utf8");
  assert.match(upgraded, /^DPF_HOST_BIND_ADDRESS=0\.0\.0\.0$/m);
  assert.match(upgraded, /Kept the exposure this install had/);

  const pinned = updateEnv(Buffer.from("DPF_HOST_BIND_ADDRESS=127.0.0.1\n"), "v2.0.0", "opendigitalproductfactory").toString("utf8");
  assert.equal((pinned.match(/^DPF_HOST_BIND_ADDRESS=/gm) ?? []).length, 1);
  assert.match(pinned, /^DPF_HOST_BIND_ADDRESS=127\.0\.0\.1$/m);
});

// BI-C26D5DC5: the Git update receiver's signing secret reaches every install.
test("an upgrade persists the secret promote.sh started the portal with, and never replaces a real one", () => {
  const exported = "a".repeat(64);
  const added = ensureGitWebhookSecret("DPF_IMAGE_TAG=v1\n", "\n", exported);
  assert.match(added, new RegExp(`^DPF_GIT_WEBHOOK_SECRET=${exported}$`, "m"));
  const placeholder = ensureGitWebhookSecret("DPF_GIT_WEBHOOK_SECRET=<generate a distinct value>\n", "\n", exported);
  assert.match(placeholder, new RegExp(`^DPF_GIT_WEBHOOK_SECRET=${exported}$`, "m"));
  const kept = ensureGitWebhookSecret(`DPF_GIT_WEBHOOK_SECRET=${"b".repeat(64)}\n`, "\n", exported);
  assert.equal(kept, `DPF_GIT_WEBHOOK_SECRET=${"b".repeat(64)}\n`);
  const generated = ensureGitWebhookSecret("", "\n", "");
  assert.match(generated, /^DPF_GIT_WEBHOOK_SECRET=[0-9a-f]{64}$/m);
});

test("updateEnv carries the webhook secret into the committed install env", () => {
  const previous = process.env.DPF_GIT_WEBHOOK_SECRET;
  process.env.DPF_GIT_WEBHOOK_SECRET = "c".repeat(64);
  try {
    const text = updateEnv(Buffer.from("DPF_IMAGE_TAG=v1.0.0\n"), "v2.0.0", "opendigitalproductfactory").toString("utf8");
    assert.match(text, new RegExp(`^DPF_GIT_WEBHOOK_SECRET=${"c".repeat(64)}$`, "m"));
  } finally {
    if (previous === undefined) delete process.env.DPF_GIT_WEBHOOK_SECRET; else process.env.DPF_GIT_WEBHOOK_SECRET = previous;
  }
});

// BI-8541D491: the GPP permit signing key reaches every install the same way.
test("an upgrade persists the permit key promote.sh started the portal with, and never replaces a real one", () => {
  const exported = "f".repeat(64);
  const added = ensureGppPermitSecret("DPF_IMAGE_TAG=v1\n", "\n", exported);
  assert.match(added, new RegExp(`^DPF_GPP_PERMIT_SECRET=${exported}$`, "m"));
  const placeholder = ensureGppPermitSecret('DPF_GPP_PERMIT_SECRET="<generate a distinct value>"\n', "\n", exported);
  assert.match(placeholder, new RegExp(`^DPF_GPP_PERMIT_SECRET=${exported}$`, "m"));
  const kept = ensureGppPermitSecret(`DPF_GPP_PERMIT_SECRET="${"1".repeat(64)}"\n`, "\n", exported);
  assert.equal(kept, `DPF_GPP_PERMIT_SECRET="${"1".repeat(64)}"\n`);
  const generated = ensureGppPermitSecret("", "\n", "");
  assert.match(generated, /^DPF_GPP_PERMIT_SECRET=[0-9a-f]{64}$/m);
  const crlf = ensureGppPermitSecret("DPF_IMAGE_TAG=v1\r\n", "\r\n", exported);
  assert.ok(crlf.endsWith(`DPF_GPP_PERMIT_SECRET=${exported}\r\n`));
});

test("updateEnv carries the permit key into the committed install env without touching the webhook secret", () => {
  const previous = { permit: process.env.DPF_GPP_PERMIT_SECRET, webhook: process.env.DPF_GIT_WEBHOOK_SECRET };
  process.env.DPF_GPP_PERMIT_SECRET = "2".repeat(64);
  process.env.DPF_GIT_WEBHOOK_SECRET = "3".repeat(64);
  try {
    const text = updateEnv(Buffer.from("DPF_IMAGE_TAG=v1.0.0\n"), "v2.0.0", "opendigitalproductfactory").toString("utf8");
    assert.match(text, new RegExp(`^DPF_GPP_PERMIT_SECRET=${"2".repeat(64)}$`, "m"));
    assert.match(text, new RegExp(`^DPF_GIT_WEBHOOK_SECRET=${"3".repeat(64)}$`, "m"));
    const kept = updateEnv(Buffer.from(`DPF_GPP_PERMIT_SECRET=${"4".repeat(64)}\n`), "v2.0.0", "o").toString("utf8");
    assert.match(kept, new RegExp(`^DPF_GPP_PERMIT_SECRET=${"4".repeat(64)}$`, "m"));
  } finally {
    if (previous.permit === undefined) delete process.env.DPF_GPP_PERMIT_SECRET; else process.env.DPF_GPP_PERMIT_SECRET = previous.permit;
    if (previous.webhook === undefined) delete process.env.DPF_GIT_WEBHOOK_SECRET; else process.env.DPF_GIT_WEBHOOK_SECRET = previous.webhook;
  }
});

// BI-3267763F: no install keeps running Inngest on the keys published in the repo.
test("an upgrade persists the Inngest keys promote.sh exported and replaces the public defaults", () => {
  const exported = { INNGEST_SIGNING_KEY: "d".repeat(64), INNGEST_EVENT_KEY: "e".repeat(64) };
  const fromDefaults = ensureInngestKeys("INNGEST_SIGNING_KEY=abcdef0123456789\nINNGEST_EVENT_KEY=deadbeefcafebabe\n", "\n", exported); // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
  assert.equal(fromDefaults, `INNGEST_SIGNING_KEY=${"d".repeat(64)}\nINNGEST_EVENT_KEY=${"e".repeat(64)}\n`);
  const missing = ensureInngestKeys("DPF_IMAGE_TAG=v1", "\n", exported);
  assert.match(missing, new RegExp(`^INNGEST_SIGNING_KEY=${"d".repeat(64)}$`, "m"));
  assert.match(missing, new RegExp(`^INNGEST_EVENT_KEY=${"e".repeat(64)}$`, "m"));
  const placeholder = ensureInngestKeys('INNGEST_SIGNING_KEY="<generate with: openssl rand -hex 32>"\n', "\n", exported);
  assert.match(placeholder, new RegExp(`^INNGEST_SIGNING_KEY=${"d".repeat(64)}$`, "m"));
  const real = `INNGEST_SIGNING_KEY=${"1".repeat(64)}\nINNGEST_EVENT_KEY=${"2".repeat(64)}\n`;
  assert.equal(ensureInngestKeys(real, "\n", exported), real, "a real key is never rotated");
});

test("an exported public default is never persisted; a random key is generated instead", () => {
  const text = ensureInngestKeys("", "\n", { INNGEST_SIGNING_KEY: "abcdef0123456789", INNGEST_EVENT_KEY: "deadbeefcafebabe" }); // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
  assert.match(text, /^INNGEST_SIGNING_KEY=[0-9a-f]{64}$/m);
  assert.match(text, /^INNGEST_EVENT_KEY=[0-9a-f]{64}$/m);
  assert.doesNotMatch(text, /abcdef0123456789|deadbeefcafebabe/);
});

test("updateEnv carries the Inngest keys into the committed install env", () => {
  const text = updateEnv(Buffer.from("DPF_IMAGE_TAG=v1.0.0\r\nINNGEST_SIGNING_KEY=abcdef0123456789\r\n"), "v2.0.0", "opendigitalproductfactory").toString("utf8"); // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
  assert.match(text, /^INNGEST_SIGNING_KEY=[0-9a-f]{64}\r$/m);
  assert.match(text, /^INNGEST_EVENT_KEY=[0-9a-f]{64}\r$/m);
});
