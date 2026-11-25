import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCoveredUploadCollisions, captureRestoreUploadRoots, inspectRestoreUploadDestinations, publishRestoreUploadFile } from "./restore-upload-destinations";

const sha = (content: string) => createHash("sha256").update(content).digest("hex");
const member = (path: string, content: string, root = "upload-store") => ({ root, path, sha256: sha(content) });
let workspace: string;
let receiverPath: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(await realpath(tmpdir()), "dpf-upload-receiver-"));
  receiverPath = join(workspace, "uploads");
  await mkdir(receiverPath);
});
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "linux")("managed upload restore receiving roots", () => {
  it("distinguishes missing files, matching no-ops, and originals requiring safety coverage without writing", async () => {
    const roots = await captureRestoreUploadRoots([{ name: "upload-store", path: receiverPath }]);
    await writeFile(join(receiverPath, "same"), "same");
    await writeFile(join(receiverPath, "changed"), "old");
    await writeFile(join(receiverPath, "unlisted"), "preserve");
    const members = [member("same", "same"), member("changed", "restored"), member("new", "fresh")];
    const preview = await inspectRestoreUploadDestinations(roots, members);
    expect(preview.entries.map(({ path, observedSha256 }) => [path, observedSha256])).toEqual([
      ["changed", sha("old")], ["new", null], ["same", sha("same")],
    ]);
    expect(() => assertCoveredUploadCollisions(preview, [member("changed", "wrong")])).toThrow(/safety/i);
    expect(() => assertCoveredUploadCollisions(preview, [member("changed", "old")])).not.toThrow();
    expect(await readFile(join(receiverPath, "changed"), "utf8")).toBe("old");
    expect(await readFile(join(receiverPath, "unlisted"), "utf8")).toBe("preserve");
    await expect(readFile(join(receiverPath, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(receiverPath, "new"), "added after preview");
    expect((await inspectRestoreUploadDestinations(roots, members)).collisionSetSha256).not.toBe(preview.collisionSetSha256);
  });

  it("refuses redirected or replaced receiver roots and unsafe logical destinations", async () => {
    const roots = await captureRestoreUploadRoots([{ name: "upload-store", path: receiverPath }]);
    const outside = join(workspace, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "bytes"), "outside");
    await symlink(outside, join(receiverPath, "link"));
    await expect(inspectRestoreUploadDestinations(roots, [member("link/bytes", "take")])).rejects.toThrow();
    await expect(inspectRestoreUploadDestinations(roots, [member("../outside/bytes", "take")])).rejects.toThrow();
    await expect(inspectRestoreUploadDestinations(roots, [member("bytes", "take", "wrong-root")])).rejects.toThrow(/root/i);
    await rename(receiverPath, join(workspace, "old-uploads"));
    await mkdir(receiverPath);
    await expect(inspectRestoreUploadDestinations(roots, [member("new", "take")])).rejects.toThrow(/identity/i);
    expect(await readFile(join(outside, "bytes"), "utf8")).toBe("outside");
  });

  it("refuses existing hard links and member paths that alias a directory", async () => {
    const { link } = await import("node:fs/promises");
    const roots = await captureRestoreUploadRoots([{ name: "upload-store", path: receiverPath }]);
    const original = join(workspace, "original");
    await writeFile(original, "untouched");
    await link(original, join(receiverPath, "hard"));
    await expect(inspectRestoreUploadDestinations(roots, [member("hard", "take")])).rejects.toThrow(/single-link/i);
    await expect(inspectRestoreUploadDestinations(roots, [member("prefix", "file"), member("prefix/child", "take")])).rejects.toThrow(/alias/i);
  });

  it("publishes only the verified content and makes repeated publication and undo no-ops", async () => {
    const [root] = await captureRestoreUploadRoots([{ name: "upload-store", path: receiverPath }]);
    const file = { rootName: "upload-store", relativePath: "media/file", beforeSha256: null, afterSha256: sha("restored") };
    async function* content(value: string) { yield Buffer.from(value); }
    await expect(publishRestoreUploadFile(root!, file, { sizeBytes: 8, content: content("not-good") })).rejects.toThrow(/digest/);
    const target = join(receiverPath, "media/file");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(publishRestoreUploadFile(root!, file, { sizeBytes: 8, content: content("restored") })).resolves.toBe(sha("restored"));
    await expect(publishRestoreUploadFile(root!, file)).resolves.toBe(sha("restored"));
    expect(await readFile(target, "utf8")).toBe("restored");
    await expect(publishRestoreUploadFile(root!, { ...file, beforeSha256: sha("unrelated"), afterSha256: null })).rejects.toThrow(/changed/i);
    const undo = { ...file, beforeSha256: sha("restored"), afterSha256: null };
    await expect(publishRestoreUploadFile(root!, undo)).resolves.toBeNull();
    await expect(publishRestoreUploadFile(root!, undo)).resolves.toBeNull();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
