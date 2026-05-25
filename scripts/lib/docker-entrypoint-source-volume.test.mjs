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
