import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contractContext, findInstallFolder, findSourceCheckout } from "./install-folder-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A host laid out like the founder's: <root>/DPF (install) beside <root>/DPF-source-root (checkout).
function host() {
  const root = mkdtempSync(join(tmpdir(), "dpf-host-"));
  const install = join(root, "DPF");
  const source = join(root, "DPF-source-root");
  mkdirSync(install);
  writeFileSync(join(install, ".install-mode"), "consumer\n");
  mkdirSync(join(source, "packages", "dpf-skill-pack"), { recursive: true });
  writeFileSync(join(source, "AGENTS.md"), "# Contract\n\n## Build Discipline\n\n## Branch and Worktree Discipline\n");
  return { root, install, source };
}

test("BI-77BE1389: an install-folder session is told where the source contract is, with its sections", () => {
  const { install, source } = host();
  const context = contractContext(install, {});
  assert.ok(context.includes(`${source.replace(/\\/g, "/")}/AGENTS.md`));
  assert.match(context, /read .* in full/);
  assert.match(context, /Build Discipline; Branch and Worktree Discipline/);
});

test("finds the checkout from DPF_SOURCE_ROOT first, then the conventional sibling name", () => {
  const { install, source } = host();
  assert.equal(findSourceCheckout(install, {}), source);
  const other = host();
  assert.equal(findSourceCheckout(install, { DPF_SOURCE_ROOT: other.source }), other.source);
});

test("says so when no checkout sits beside the install", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-lone-"));
  writeFileSync(join(root, ".install-mode"), "consumer\n");
  assert.match(contractContext(root, {}), /no source checkout was found/);
});

test("emits nothing inside a checkout or outside any DPF folder", () => {
  assert.equal(findInstallFolder(HERE), null, "this checkout loads its own AGENTS.md");
  assert.equal(contractContext(mkdtempSync(join(tmpdir(), "not-dpf-")), {}), null);
});

test("the hook writes a SessionStart additionalContext envelope", () => {
  const { install } = host();
  const out = execFileSync("node", [join(HERE, "install-folder-contract.mjs")], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: install }),
    encoding: "utf8",
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(parsed.hookSpecificOutput.additionalContext, /AGENTS\.md/);
});
