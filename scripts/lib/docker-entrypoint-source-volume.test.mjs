import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const entrypoint = readFileSync(new URL("../../docker-entrypoint.sh", import.meta.url), "utf8");

function functionBody(name) {
  const match = entrypoint.match(new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} function should exist`);
  return match[1];
}

test("source-volume refresh marks /workspace as a Git safe directory before status checks", () => {
  const body = functionBody("ensure_workspace_safe_directory");
  assert.match(body, /safe\.directory/);
  assert.match(body, /\$WORKSPACE/);

  const userChangeBody = functionBody("workspace_has_user_changes");
  assert.ok(
    userChangeBody.indexOf("ensure_workspace_safe_directory") <
      userChangeBody.indexOf("git rm -r --cached"),
    "workspace change detection should add the safe-directory allowance before Git status operations",
  );
});

test("source-volume snapshot commits add the safe-directory allowance before local Git config", () => {
  const snapshotBody = functionBody("commit_workspace_snapshot");
  assert.ok(
    snapshotBody.indexOf("ensure_workspace_safe_directory") <
      snapshotBody.indexOf("git config user.email"),
    "snapshot commit should add the safe-directory allowance before local Git config writes",
  );

  assert.match(
    entrypoint,
    /git init -b dpf-upstream\s+ensure_workspace_safe_directory\s+git config user\.email/,
  );
});

test("workspace dependency install disables pnpm's interactive modules purge prompt", () => {
  const body = functionBody("install_workspace_dependencies");
  const matches = [...body.matchAll(/pnpm install(?: --frozen-lockfile)? --config\.confirmModulesPurge=false/g)];

  assert.equal(
    matches.length,
    2,
    "both frozen and fallback pnpm install commands should disable the non-TTY modules purge prompt",
  );
});

test("Engine B image-version source-advance is retired — no /workspace re-sync on version drift (BI-5B6C1C35)", () => {
  // The image-version-vs-/workspace/.dpf-version detection block must NOT, on a
  // version mismatch of an ALREADY-bootstrapped volume, silently re-sync the
  // running container's source or arm an update. Per governed-upgrade spec §5.0
  // the running install advances ONLY via the host-clone self-upgrade pipeline
  // (Engine A). Assert the dangerous calls no longer live in that branch.
  const driftBranch = entrypoint.match(
    /elif \[ -f "\$WORKSPACE\/\.dpf-version" \]; then([\s\S]*?)\nelse\n  echo "  -- \/workspace not mounted/,
  );
  assert.ok(driftBranch, "the .dpf-version-present (drift-detection) branch should exist");
  const body = driftBranch[1];

  // Strip comment lines so the prose that EXPLAINS the retirement (which names
  // the old mechanisms) doesn't trip the "no longer does X" assertions.
  const executable = body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  // No raw psql write of the updatePending / pendingVersion sentinel.
  assert.doesNotMatch(executable, /psql/, "must not run psql in the drift-detection branch");
  assert.doesNotMatch(executable, /updatePending/, "must not write the updatePending sentinel via psql");
  assert.doesNotMatch(executable, /pendingVersion/, "must not write the pendingVersion sentinel via psql");

  // No silent source re-sync from the image into the running /workspace.
  assert.doesNotMatch(
    executable,
    /sync_image_source_to_workspace/,
    "must not re-sync image source into the running /workspace on version drift",
  );
  assert.doesNotMatch(
    executable,
    /commit_workspace_snapshot/,
    "must not snapshot-commit a silently advanced /workspace on version drift",
  );

  // The branch must declare the retirement so the intent is auditable.
  assert.match(body, /BI-5B6C1C35/, "the retired branch should cite the BI");
  assert.match(body, /Self-Upgrade/i, "the retired branch should point operators at Engine A");
});

test("the entrypoint no longer issues any psql updatePending write (Engine B retired)", () => {
  // Belt-and-braces across the whole script: no EXECUTABLE line may write
  // PlatformDevConfig.updatePending. Engine A owns advance signalling. Comment
  // prose that names the retired mechanism is allowed and is stripped here.
  const executableLines = entrypoint
    .split("\n")
    .filter((line) => !/^\s*#/.test(line));
  const offending = executableLines.filter((line) => /updatePending/.test(line));
  assert.deepEqual(
    offending,
    [],
    `no executable line may write updatePending; found: ${offending.join(" | ")}`,
  );
});

test("first-install volume bootstrap is preserved (does not regress fresh installs)", () => {
  // Neutralising Engine B must NOT break first-install: an EMPTY /workspace is
  // still populated so surfaces that mount it (the :3001 contributor preview,
  // sandbox tooling) have a source tree. The bootstrap branch keys off the
  // ABSENCE of .dpf-version and still calls the populate + dependency-install path.
  const bootstrapBranch = entrypoint.match(
    /elif \[ -d "\$WORKSPACE" \] && \[ ! -f "\$WORKSPACE\/\.dpf-version" \]; then([\s\S]*?)\nelif \[ -f "\$WORKSPACE\/\.dpf-version" \]; then/,
  );
  assert.ok(bootstrapBranch, "the first-install (no-.dpf-version) bootstrap branch should exist");
  const body = bootstrapBranch[1];
  assert.match(body, /sync_image_source_to_workspace/, "first-install must still populate the empty volume");
  assert.match(body, /install_workspace_dependencies/, "first-install must still install dependencies");
  assert.match(body, /echo "\$IMAGE_VERSION" > "\$WORKSPACE\/\.dpf-version"/, "first-install must still write the version sentinel");
});

test("workspace dependency install skips lifecycle scripts before explicit Prisma generation", () => {
  const body = functionBody("install_workspace_dependencies");
  const installMatches = [...body.matchAll(/pnpm install(?: --frozen-lockfile)? --config\.confirmModulesPurge=false --ignore-scripts/g)];

  assert.equal(
    installMatches.length,
    2,
    "both install commands should skip lifecycle scripts while the node_modules tree is being recreated",
  );
  assert.match(
    body,
    /pnpm --filter @dpf\/db exec prisma generate --schema prisma\/schema\.prisma/,
    "Prisma generation should use the db package CLI with the package-relative schema path",
  );
  assert.doesNotMatch(
    body,
    /pnpm exec prisma generate --schema packages\/db\/prisma\/schema\.prisma/,
    "Prisma generation should not rely on the workspace-root CLI link in the production source volume",
  );
});
