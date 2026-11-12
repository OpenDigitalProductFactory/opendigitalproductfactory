#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile as readPackagedFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntryModule } from "../../../../scripts/lib/entry-module.mjs";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const refuse = detail => { throw new Error(`scope_writer_probe_${detail}`); };
const packaged = (root, path) => join(root, path.replace(/^apps\/web\//, "apps/web-src/"));

/** Read-only packaged-byte observation; not workflow or retirement proof.
 * Injection is for source tests only. The executable always inspects /app. */
export async function inspectScopeEpochWriters({ root = "/app", readFile = readPackagedFile,
  loadContract = path => import(pathToFileURL(path).href) } = {}) {
  try {
    const path = packaged(root, "apps/web/lib/work-capsules/scope-epoch-contract.ts");
    const contract = await loadContract(path);
    if (contract.SCOPE_EPOCH_WRITER_CONTRACT_VERSION !== 1 || !Array.isArray(contract.SCOPE_EPOCH_WRITER_PATHS)
      || !contract.SCOPE_EPOCH_WRITER_PATHS.length || new Set(contract.SCOPE_EPOCH_WRITER_PATHS).size !== contract.SCOPE_EPOCH_WRITER_PATHS.length
      || typeof contract.validateScopeEpochWriterContract !== "function") refuse("contract_invalid");
    const [version, content, contractBytes] = await Promise.all([readFile(join(root, ".dpf-image-version")),
      readFile(join(root, ".dpf-source-content-hash")), readFile(path)]);
    const sourceSha = version.toString("utf8").trim(), sourceContentHash = content.toString("utf8").trim();
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(sourceContentHash)) refuse("identity_invalid");
    const writers = {};
    for (const owner of contract.SCOPE_EPOCH_WRITER_PATHS) {
      if (typeof owner !== "string" || !/^(apps\/web\/|scripts\/)[a-zA-Z0-9_./-]+\.(ts|mjs)$/.test(owner)
        || owner.split("/").some(part => part === ".." || part === ".")) refuse("contract_invalid");
      writers[owner] = sha256(await readFile(packaged(root, owner)));
    }
    return contract.validateScopeEpochWriterContract({ schemaVersion: 1, version: 1, sourceSha, sourceContentHash,
      contractSha256: sha256(contractBytes), writers });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("scope_writer_probe_")) throw error;
    refuse("evidence_unavailable");
  }
}
if (isEntryModule(import.meta.url)) {
  try {
    if (process.argv.length !== 2) refuse("arguments_invalid");
    process.stdout.write(`${JSON.stringify(await inspectScopeEpochWriters())}\n`);
  } catch { process.stderr.write("scope_writer_probe_unavailable\n"); process.exitCode = 78; }
}
