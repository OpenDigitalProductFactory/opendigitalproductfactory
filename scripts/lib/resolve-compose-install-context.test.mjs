import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";

import { resolveComposeInstallContext, resolveDpfStatePath } from "./resolve-compose-install-context.mjs";

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
