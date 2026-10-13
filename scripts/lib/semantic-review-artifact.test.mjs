import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSemanticReviewReceipt, assessSemanticReviewReceiptFreshness,
  buildSemanticChangeReviewPrompt,
} from '../../apps/web/lib/change-review/semantic-change-review.ts';
import { deriveSemanticReviewGateIdentity } from '../../apps/web/lib/gates/gate-run-identity.ts';

const identity = {
  capsuleId: 'WC-ARTIFACT', baseTreeHash: 'a'.repeat(40), headTreeHash: 'b'.repeat(40),
  diffDigest: 'c'.repeat(64), policyVersion: 'policy', reviewerVersion: 'reviewer',
  specialistIds: [], artifactType: 'spec',
};

test('identical bytes reviewed as a spec do not authorize a code change', () => {
  const receipt = createSemanticReviewReceipt({ identity, disposition: 'reviewed', risk: 'high',
    result: { decision: 'pass', issues: [], summary: 'Reviewed spec.' } });
  assert.equal(assessSemanticReviewReceiptFreshness(receipt, { ...identity, artifactType: 'code-change' }).fresh, false);
});

test('different roles cannot join one review even with identical content and risk', () => {
  const input = { repository: 'owner/repo', identity, risk: 'high', dispatchContractVersion: 'dispatch' };
  assert.notEqual(deriveSemanticReviewGateIdentity(input).gateKey,
    deriveSemanticReviewGateIdentity({ ...input, identity: { ...identity, artifactType: 'plan' } }).gateKey);
});

test('document review asks about requirements and evidence instead of requiring application styling', () => {
  const input = { title: 'A design', artifact: 'Immutable design contents', verificationEvidence: 'Document validation passed.' };
  const spec = buildSemanticChangeReviewPrompt({ ...input, artifactType: 'spec' });
  const code = buildSemanticChangeReviewPrompt({ ...input, artifactType: 'code-change' });
  assert.notEqual(spec, code);
  assert.match(spec, /acceptance|requirements/i);
  assert.doesNotMatch(spec, /Tailwind|CSS variables/);
  assert.match(spec, /immutable artifact/);
  assert.match(spec, /cannot-verify/);
});
