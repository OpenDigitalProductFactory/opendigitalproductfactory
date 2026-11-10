// Synthetic execution material for the real supervisor contract tests only.
// Never imported by a production runner or used as canonical CI evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEvidencePolicy } from '../../../scripts/lib/ci-evidence-plan.mjs';

export async function completeFixture(env = process.env) {
  // Keep this tiny command alive long enough to exercise the real process scan.
  // A command whose ownership was never observed must remain inconclusive.
  await delay(1000);
  const state = JSON.parse(readFileSync(env.DPF_LOCAL_CI_GATE_STATE_FILE, 'utf8'));
  let prior = {};
  try { prior = JSON.parse(readFileSync(env.DPF_LOCAL_CI_METADATA_FILE, 'utf8')); } catch {}
  const artifact = { kind: 'delegated', identity: 'synthetic-contract-fixture' };
  const metadata = {
    ...prior, candidateRef: state.branch, candidateSha: state.sha,
    runLeaseId: env.DPF_NONPROD_LEASE_ID,
    baseSha: 'b'.repeat(40), integrationCommitSha: 'c'.repeat(40), synthesizedTreeSha: 'd'.repeat(40),
    toolchainFingerprint: 'e'.repeat(64),
    evidencePlan: { digest: 'f'.repeat(64), policyVersion: loadEvidencePolicy().policyVersion },
    productionArtifact: artifact, commands: [{ command: 'synthetic contract fixture' }],
    execution: { status: 'passed', exitCode: 0, completedCommandCount: 1 },
    completedAt: new Date().toISOString(),
  };
  writeFileSync(env.DPF_LOCAL_CI_METADATA_FILE, JSON.stringify(metadata));
  writeFileSync(env.DPF_LOCAL_CI_ARTIFACT_FILE, JSON.stringify(artifact));
  return metadata;
}
