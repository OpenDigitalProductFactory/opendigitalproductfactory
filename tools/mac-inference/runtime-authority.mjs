// The host runtime requires Node's supported native TypeScript loader (>=22.18)
// to reuse the canonical protocol verifier rather than clone its signing rules.
import { canonicalizeEdgeActionEnvelope, verifyEdgeActionEnvelope } from '../../packages/db/src/edge-action-envelope.ts';
import { parseManagedInferenceTransitionParameters } from '../../packages/db/src/remote-action-dispatch.ts';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';
import { sha256 } from './package.mjs';

const authorities = new WeakSet();
const check = (ok, message) => { if (!ok) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function parameters(value) {
  check(parseManagedInferenceTransitionParameters(value) !== null, 'Transition envelope parameters invalid');
}
function verified(signed, options, kind) {
  check(object(signed), kind + ' envelope invalid');
  let result;
  try { result = verifyEdgeActionEnvelope(signed, options); }
  catch { throw new Error(kind + ' envelope invalid'); }
  check(result.ok, kind + ' envelope ' + result.reason);
}
export async function createTransitionAuthority({ envelope, publicKey, expectedNodeId, readAdmission, now = Date.now }) {
  check(publicKey?.type === 'public' && publicKey.asymmetricKeyType === 'ed25519'
    && typeof readAdmission === 'function', 'Transition envelope key/admission reader invalid');
  // Keep precisely the verified value. Caller mutation cannot alter a later
  // operation, digest or service ownership binding after this boundary.
  const action = JSON.parse(canonicalJson(envelope));
  verified(action, { publicKey, expectedNodeId, now: new Date(now()) }, 'Transition');
  check(action.actionType === 'inference.runtime.transition'
    && /^[A-Za-z][A-Za-z0-9_-]{1,95}$/.test(action.actionKey), 'Transition envelope type/key invalid');
  parameters(action.parameters); Object.freeze(action.parameters); Object.freeze(action);
  const requestDigest = sha256(canonicalizeEdgeActionEnvelope(action));
  const authority = Object.freeze({ action, requestDigest,
    async assertCurrent() {
      const current = now();
      verified(action, { publicKey, expectedNodeId, now: new Date(current) }, 'Transition');
      const admission = await readAdmission();
      // Recheck time after the asynchronous read, including a delayed parent or
      // a resumed process. Its signed action expiry is never extended here.
      const observed = now();
      verified(action, { publicKey, expectedNodeId, now: new Date(observed) }, 'Transition');
      verified(admission, { publicKey, expectedNodeId, now: new Date(observed) }, 'Admission');
      const p = admission.parameters;
      check(admission.actionType === 'inference.runtime.admission' && admission.actionKey === action.actionKey
        && Date.parse(admission.expiresAt) <= Date.parse(action.expiresAt)
        && Date.parse(admission.expiresAt) - Date.parse(admission.issuedAt) <= 30000
        && Date.parse(admission.issuedAt) <= observed && object(p)
        && Object.keys(p).sort().join(',') === ['schemaVersion', 'ready', 'requestDigest', 'leaseId', 'ownerSessionId', 'branchName', 'quiescenceRunId', 'approvedChangeRequestId'].sort().join(',')
        && p.schemaVersion === 1 && p.ready === true && p.requestDigest === requestDigest && p.leaseId === action.parameters.leaseId
        && typeof p.quiescenceRunId === 'string' && /^QR-[A-Za-z0-9_-]{1,120}$/.test(p.quiescenceRunId)
        && typeof p.approvedChangeRequestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.approvedChangeRequestId),
      'Native admission binding, fresh drain or approved change unavailable');
      check(typeof p.ownerSessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.ownerSessionId)
        && typeof p.branchName === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(p.branchName)
        && !p.branchName.includes('..') && !p.branchName.includes('//'), 'Native admission lease owner/source binding unavailable');
      return Object.freeze({ ...p, expiresAt: admission.expiresAt });
    },
  });
  await authority.assertCurrent(); authorities.add(authority); return authority;
}
export function requireTransitionAuthority(authority) {
  check(authorities.has(authority), 'Unverified transition authority'); return authority;
}
