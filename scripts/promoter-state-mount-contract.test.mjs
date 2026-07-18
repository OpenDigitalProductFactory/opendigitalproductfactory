import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const promoter = readFileSync(resolve(root, "apps/web/lib/self-upgrade/promoter.ts"), "utf8");
const script = readFileSync(resolve(root, "scripts/promote.sh"), "utf8");
const contract = JSON.parse(readFileSync(resolve(root, "promoter-contract.json"), "utf8"));

test("promoter internal state path cannot override install env host interpolation", () => {
  const installEnv = { DPF_STATE_DIR: "C:\\Users\\operator\\.dpf" };
  const promoterContainerEnv = { DPF_PROMOTER_STATE_DIR: "/dpf-state" };
  const composeInterpolationEnv = { ...installEnv, ...promoterContainerEnv };

  assert.equal(composeInterpolationEnv.DPF_STATE_DIR, installEnv.DPF_STATE_DIR);
  assert.notEqual(composeInterpolationEnv.DPF_STATE_DIR, promoterContainerEnv.DPF_PROMOTER_STATE_DIR);
  assert.match(promoter, /DPF_PROMOTER_STATE_DIR=\/dpf-state/);
  assert.doesNotMatch(promoter, /["`]DPF_STATE_DIR=\/dpf-state/);
  assert.doesNotMatch(script, /\$\{DPF_STATE_DIR:-\/dpf-state\}/);
  assert.match(script, /force-recreate portal/);
  assert.match(script, /force-recreate sandbox/);
  assert.ok(contract.requiredEnvironment.includes("DPF_PROMOTER_STATE_DIR"));
  assert.ok(!contract.requiredEnvironment.includes("DPF_STATE_DIR"));
});

function assertNoHostStateNamespace(relative, source) {
  let executableSource = source;
  if (relative === "scripts/capability-service-catalog.generated.json") {
    // This generated catalog carries the portal's declarative host bind-mount
    // contract. The promoter reads only its service/capability projection; the
    // exact Compose interpolation string is data, not promoter process state.
    const declarativeMount = "${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro";
    assert.equal(source.split(declarativeMount).length - 1, 1, "catalog exception must remain one exact declarative mount");
    executableSource = source.replace(declarativeMount, "<install-state-host-mount>");
  }
  assert.doesNotMatch(executableSource, /\bDPF_STATE_DIR\b/, `${relative} must neither read nor write the host interpolation namespace`);
}

test("the complete promoter scripts closure never reads or writes host DPF_STATE_DIR", () => {
  const dockerfile = readFileSync(resolve(root, "Dockerfile.promoter"), "utf8");
  const copiedScripts = [...dockerfile.matchAll(/^COPY (scripts\/[^ ]+) /gm)].map((match) => match[1]);
  assert.ok(copiedScripts.length > 0, "promoter closure must be discovered from Dockerfile.promoter");
  for (const relative of copiedScripts) {
    const source = readFileSync(resolve(root, relative), "utf8");
    assertNoHostStateNamespace(relative, source);
  }
});

test("the closure guard rejects a promoter entrypoint that exports the host namespace", () => {
  assert.throws(
    () => assertNoHostStateNamespace("scripts/promote.sh", `${script}\nexport DPF_STATE_DIR=/dpf-state\n`),
    /scripts\/promote\.sh must neither read nor write/,
  );
});
