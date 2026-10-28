#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile as readPackagedFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntryModule } from "./lib/entry-module.mjs";

const OWNER_NAMES = ["transport", "approval", "worker", "writer"];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const refuse = code => { throw new Error(`reassessment_probe_${code}`); };
const exactOwners = value => !!value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...OWNER_NAMES].sort());

// These declarations attest component support. The byte hashes let the server
// bind them to its tested owners; discovery does not prove workflow semantics.
function declaresOwnerVersion(source, owner) {
  const tokens = (source.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][\w$]*|\d+|[^\s]/g) ?? [])
    .filter(token => !token.startsWith("//") && !token.startsWith("/*") && !token.startsWith("`"));
  let found = false;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "assertReassessmentOwnerSupport" || tokens[index + 1] !== "("
      || ![`"${owner}"`, `'${owner}'`].includes(tokens[index + 2]) || tokens[index + 3] !== ",") continue;
    if (tokens[index + 4] !== "2" || tokens[index + 5] !== ")") return false;
    found = true;
  }
  return found;
}

/** The injectable root/reader are source-test and local-observer seams only.
 * The executable CLI always inspects the immutable /app image without effects. */
export async function inspectReassessmentCapability({ root = "/app", readFile = readPackagedFile } = {}) {
  try {
    const libRoot = join(root, "apps/web-src/lib");
    const contractPath = join(libRoot, "shared/reassessment-owner-versions.ts");
    const [imageBytes, contentBytes, contractBytes] = await Promise.all([
      readFile(join(root, ".dpf-image-version")), readFile(join(root, ".dpf-source-content-hash")), readFile(contractPath),
    ]);
    const sourceSha = imageBytes.toString("utf8").trim();
    const sourceContentHash = contentBytes.toString("utf8").trim();
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(sourceContentHash)) refuse("identity_invalid");
    const contract = await import(pathToFileURL(contractPath).href);
    if (JSON.stringify(contract.REASSESSMENT_OWNERS) !== JSON.stringify(OWNER_NAMES)
      || contract.REASSESSMENT_PROTOCOL_VERSION !== 2 || !exactOwners(contract.REASSESSMENT_OWNER_PATHS)
      || !exactOwners(contract.REASSESSMENT_OWNER_VERSIONS) || typeof contract.assertReassessmentOwnerSupport !== "function") refuse("contract_invalid");
    const owners = {};
    for (const owner of OWNER_NAMES) {
      const version = contract.REASSESSMENT_OWNER_VERSIONS[owner];
      const path = contract.REASSESSMENT_OWNER_PATHS[owner];
      if (version !== 2 || typeof path !== "string" || !/^[a-zA-Z0-9_/-][a-zA-Z0-9_./-]*\.ts$/.test(path)
        || path.startsWith("/") || path.split("/").some(part => part === "." || part === "..")) refuse("owner_contract_invalid");
      contract.assertReassessmentOwnerSupport(owner, version);
      const bytes = await readFile(join(libRoot, path));
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!declaresOwnerVersion(source, owner)) refuse("owner_support_missing");
      owners[owner] = { version, sourceSha256: sha256(bytes) };
    }
    return { schemaVersion: 1, sourceSha, sourceContentHash, contractSha256: sha256(contractBytes), owners };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("reassessment_probe_")) throw error;
    refuse("evidence_unavailable");
  }
}

if (isEntryModule(import.meta.url)) {
  if (process.argv.length !== 2) {
    process.stderr.write("reassessment_probe_arguments_invalid\n");
    process.exitCode = 64;
  } else {
    try { process.stdout.write(JSON.stringify(await inspectReassessmentCapability({ root: "/app" })) + "\n"); }
    catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 78; }
  }
}
