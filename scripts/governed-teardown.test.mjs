import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildComposeDownArgs,
  canonical,
  removeTreeContentsNoFollow,
  validateDeletionRoots,
} from "./governed-teardown.mjs";

test("compose mutation stays project/file scoped and only destructive scopes delete volumes", () => {
  assert.deepEqual(
    buildComposeDownArgs({ composeProject: "dpf", composeFiles: ["docker-compose.yml", "docker-compose.windows.yml"], scope: "containers" }),
    ["compose", "--project-name", "dpf", "-f", "/install/docker-compose.yml", "-f", "/install/docker-compose.windows.yml", "down", "--remove-orphans"],
  );
  assert.deepEqual(
    buildComposeDownArgs({ composeProject: "dpf", composeFiles: ["docker-compose.yml"], scope: "everything" }).slice(-2),
    ["--remove-orphans", "--volumes"],
  );
});

test("deletion-root validation refuses broad and evidence-nested targets", () => {
  assert.throws(() => validateDeletionRoots({ installPath: "/", backupsPath: "/var/backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "/home/owner", backupsPath: "/var/backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "C:\\Users\\owner", backupsPath: "D:\\DPF-backups", installMount: "/install", evidenceMount: "/evidence" }), /unsafe_teardown_install_root/);
  assert.throws(() => validateDeletionRoots({ installPath: "/opt/dpf", backupsPath: "/opt/dpf/backups", installMount: "/install", evidenceMount: "/evidence" }), /teardown_evidence_inside_source/);
  assert.doesNotThrow(() => validateDeletionRoots({ installPath: "/opt/dpf", backupsPath: "/opt/dpf-backups", installMount: "/install", evidenceMount: "/evidence" }));
});

test("no-follow removal unlinks a link without touching its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-teardown-root-"));
  const outside = await mkdtemp(join(tmpdir(), "dpf-teardown-outside-"));
  await writeFile(join(outside, "keep.txt"), "protected\n");
  await mkdir(join(root, "ordinary"));
  await writeFile(join(root, "ordinary", "delete.txt"), "gone\n");
  const linkPath = join(root, "linked-outside");
  await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");

  const receipt = await removeTreeContentsNoFollow(root);

  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "protected\n");
  assert.equal(receipt.linksUnlinked, 1);
  assert.equal(receipt.filesDeleted, 1);
  assert.equal(receipt.directoriesDeleted, 1);
});

test("canonicalization is stable across object key order", () => {
  assert.equal(canonical({ z: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, z: 1 }));
});
