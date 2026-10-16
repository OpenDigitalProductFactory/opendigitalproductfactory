import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("grant audit recognizes provider controls composed into the authorization map", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, [
    "apps/web/scripts/audit-coworker-tool-grants.ts",
    "--baseline", "docs/superpowers/audits/2026-04-27-coworker-tool-grant-audit.json",
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout);
  const providerErrors = report.findings.filter(finding => finding.severity === "error"
    && /add_provider|update_provider_category|add-provider/.test(finding.summary));
  assert.deepEqual(providerErrors, [], "existing provider controls retain their authorization");
  for (const tool of ["get_provider_accounts", "manage_provider_account",
    "apply_platform_update", "summarize_upgrade_impact",
    "preview_runtime_capability_reconciliation", "reconcile_runtime_capabilities"]) {
    assert.equal(report.findings.some(finding => finding.invariantId === "GRANT-002"
      && finding.summary.includes(`'${tool}'`)), false, `${tool} must resolve its declared grant`);
  }
});
