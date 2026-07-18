import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";

import { canonicalizeComposeFileArgs, resolveComposeInstallContext, resolveDpfStatePath } from "./resolve-compose-install-context.mjs";

test("state path precedence is explicit, XDG, then home", () => {
  assert.equal(resolveDpfStatePath({ env: { DPF_INSTALL_STATE_PATH: "C:/state.json" }, home: "C:/home" }), resolve("C:/state.json"));
  assert.equal(resolveDpfStatePath({ env: { DPF_STATE_DIR: "C:/state" }, home: "C:/home" }), resolve("C:/state/install-state.json"));
  assert.equal(resolveDpfStatePath({ env: { XDG_STATE_HOME: "C:/xdg" }, home: "C:/home" }), resolve("C:/xdg/dpf/install-state.json"));
  assert.equal(resolveDpfStatePath({ env: {}, home: "C:/home" }), resolve("C:/home/.dpf/install-state.json"));
});

test("project-directory governs an invocation launched outside the install", () => {
  const root = resolve("C:/install");
  assert.equal(resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["--project-directory", root, "up"] }).projectRoot, root);
});

test("an explicit compose file governs an invocation launched outside the install", () => {
  const root = resolve("C:/install");
  assert.equal(resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["-f", join(root, "docker-compose.yml"), "up"] }).projectRoot, root);
});

test("different explicit compose roots fail closed", () => {
  assert.throws(
    () => resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["-f", "C:/one/docker-compose.yml", "-f", "C:/two/overlay.yml", "up"] }),
    /compose_project_root_ambiguous/,
  );
});

test("project-directory and compose file mismatch fails closed", () => {
  assert.throws(
    () => resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["--project-directory=C:/one", "--file=C:/two/docker-compose.yml", "up"] }),
    /compose_project_root_mismatch/,
  );
});

test("COMPOSE_FILE participates in root resolution with host delimiter semantics", () => {
  const root = resolve("C:/install");
  assert.equal(resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["ps"], env: { COMPOSE_FILE: `${join(root, "docker-compose.yml")};${join(root, "overlay.yml")}` }, pathDelimiter: ";" }).projectRoot, root);
});

test("CLI compose files cannot mask a different COMPOSE_FILE root", () => {
  assert.throws(
    () => resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["-f", "C:/one/docker-compose.yml", "ps"], env: { COMPOSE_FILE: "C:/two/docker-compose.yml" }, pathDelimiter: ";" }),
    /compose_file_sources_mismatch/,
  );
});

test("effective context returns an ordered absolute default compose chain", () => {
  const root = resolve("C:/install");
  assert.deepEqual(resolveComposeInstallContext({ cwd: root, args: ["config"], env: {} }).composeFiles, [join(root, "docker-compose.yml")]);
});

test("multiple CLI compose files are preserved and canonicalized once", () => {
  const root = resolve("C:/install");
  const files = [join(root, "docker-compose.yml"), join(root, "docker-compose.release.yml")];
  const context = resolveComposeInstallContext({ cwd: resolve("C:/elsewhere"), args: ["-f", files[0], "--file", files[1], "config"], env: {} });
  assert.deepEqual(context.composeFiles, files);
  assert.deepEqual(canonicalizeComposeFileArgs({ args: ["-f", files[0], "--file", files[1], "config"], composeFiles: files }), ["-f", files[0], "-f", files[1], "config"]);
});

test("different CLI and environment file chains fail closed even within one root", () => {
  const root = resolve("C:/install");
  assert.throws(
    () => resolveComposeInstallContext({ cwd: root, args: ["-f", join(root, "docker-compose.yml"), "config"], env: { COMPOSE_FILE: join(root, "docker-compose.release.yml") }, pathDelimiter: ";" }),
    /compose_file_sources_mismatch/,
  );
});
