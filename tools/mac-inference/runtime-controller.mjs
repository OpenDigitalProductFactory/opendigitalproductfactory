import { mkdir, open, rename } from 'node:fs/promises';
import { randomUUID, createPublicKey } from 'node:crypto';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';
import { protectedDirectory, protectedRead } from '../../scripts/installer/recovery-filesystem.mjs';
import { acquireRuntimeApplyLock } from '../../scripts/installer/runtime-apply-lock.mjs';
import { updateInstallState } from '../../scripts/installer/install-state-transaction.mjs';
import { validateInstallState } from '../../scripts/installer/validate-install-state.mjs';
import { sha256, readPackageManifest } from './package.mjs';
import { createTransitionAuthority, requireTransitionAuthority } from './runtime-authority.mjs';
import { createNativeRuntimeAdapter } from './runtime-native-adapter.mjs';
import { isEntryModule } from '../../scripts/lib/entry-module.mjs';

const stores = new WeakSet();
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function child(parent, name) {
  const path = join(parent, name);
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return protectedDirectory(path);
}
async function flushed(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function selection(action, mode) {
  const { version, operation, leaseId, ...binding } = action.parameters;
  return { schemaVersion: 1, mode, actionKey: action.actionKey, nodeId: action.nodeId,
    device: 'Apple M5 Max', port: 12436, ...binding };
}

/** Native filesystem implementation, sharing the install-state transaction and
 * whole-operation apply lock with the existing installer. It never reclaims an
 * uncertain lock or reruns an existing action key. */
export function createNativeTransitionStore({ stateDirectory }) {
  const store = Object.freeze({
    async withOperation({ action, requestDigest, baseline }, run) {
      const root = await protectedDirectory(stateDirectory);
      const lock = await acquireRuntimeApplyLock({ stateDirectory: root, runId: action.actionKey });
      let settled = false, began = false;
      try {
        const statePath = join(root, 'install-state.json');
        let stateBytes = await protectedRead(statePath);
        const original = JSON.parse(stateBytes.toString());
        check((await validateInstallState(original)).valid && original.platform === 'darwin' && original.arch === 'arm64', 'Native install state invalid or hardware unqualified');
        const prior = original.managedInference;
        const expectedMode = action.parameters.operation === 'activate' ? 'docker' : 'native';
        check((prior?.mode ?? 'docker') === expectedMode, 'Native selection already active, occupied or uncertain');
        if (expectedMode === 'native') {
          const previousBinding = Object.fromEntries(Object.keys(action.parameters)
            .filter(key => !['version', 'operation', 'leaseId'].includes(key)).map(key => [key, prior[key]]));
          const { version, operation, leaseId, ...binding } = action.parameters;
          check(prior.nodeId === action.nodeId && canonicalJson(previousBinding) === canonicalJson(binding), 'Rollback active selection binding changed');
        }
        const home = await child(root, 'mac-inference'), operations = await child(home, 'operations');
        const journalPath = join(operations, action.actionKey + '.json');
        const journal = { schemaVersion: 1, action, requestDigest, baseline, priorManaged: prior ?? null,
          status: 'started', phases: [], startedAt: new Date().toISOString() };
        // Creation is the execution boundary, before every host effect. A lost
        // acknowledgement keeps this key consumed even if the owner dies.
        try { await flushed(journalPath, canonicalJson(journal)); }
        catch (error) { if (error.code === 'EEXIST') throw new Error('Native action already consumed'); throw error; }
        began = true; await syncDirectory(operations);
        let expectedSelection = prior, fenced = false;
        const persistJournal = async () => {
          await lock.assertOwned();
          const next = join(operations, '.' + action.actionKey + '-' + randomUUID() + '.tmp');
          await flushed(next, canonicalJson(journal));
          await rename(next, journalPath); await syncDirectory(operations);
        };
        const updateSelection = async value => {
          await lock.assertOwned();
          const result = await updateInstallState(statePath, current => {
            check(canonicalJson(current?.managedInference ?? null) === canonicalJson(expectedSelection ?? null), 'Native selection ownership changed');
            const next = { ...current };
            if (value === undefined) delete next.managedInference; else next.managedInference = value;
            return next;
          }, { expectedSourceSha256: sha256(stateBytes) });
          stateBytes = Buffer.from(JSON.stringify(result.state, null, 2) + '\n');
          check(sha256(stateBytes) === result.writtenSha256, 'Native state acknowledgement changed');
          expectedSelection = value;
        };
        const transaction = Object.freeze({
          original, baseline,
          async phase(name, evidence) {
            journal.phases.push({ name, at: new Date().toISOString(), ...(evidence ? { evidence } : {}) }); await persistJournal();
          },
          async fence() { await updateSelection(selection(action, 'transitioning')); fenced = true; },
          async select(mode) { check(fenced, 'Native transition has no request fence'); await updateSelection(selection(action, mode)); },
          async restore() { check(fenced, 'Native transition has no rollback record'); await updateSelection(prior); },
          async uncertain() {
            journal.status = 'uncertain';
            if (fenced) await updateSelection(selection(action, 'uncertain'));
            await persistJournal();
          },
          async settle(status) { journal.status = status; await persistJournal(); settled = true; },
        });
        return await run(transaction);
      } finally {
        // No execution began, or all effects were positively settled. Unknown
        // native descendants/requests retain the actual exclusion boundary.
        if (!began || settled) check(await lock.release(), 'Native operation lock release unconfirmed');
      }
    },
  });
  stores.add(store); return store;
}

/** Host effects are supplied by the fixed native adapter, never by action
 * parameters. This transaction owns ordering, rollback and uncertainty. */
export async function executeManagedRuntimeTransition({ authority, store, runtime, signal }) {
  authority = requireTransitionAuthority(authority);
  check(stores.has(store), 'Native transition store is unverified');
  let baseline;
  try {
    await authority.assertCurrent();
    baseline = await runtime.preflight(authority.action);
    await authority.assertCurrent();
    if (signal?.aborted) throw new Error('Native transition cancelled before execution');
  } catch (error) { error.nativeSettlement = 'not-started'; throw error; }
  return store.withOperation({ action: authority.action, requestDigest: authority.requestDigest, baseline }, async tx => {
    let effects = false;
    const step = async (name, invoke) => {
      if (signal?.aborted) throw new Error('Native transition cancelled');
      await authority.assertCurrent(); await tx.phase(name + '-attempted');
      const result = await invoke(); await authority.assertCurrent();
      if (signal?.aborted) throw new Error('Native transition cancelled');
      await tx.phase(name + '-confirmed', result?.evidence); return result;
    };
    try {
      await authority.assertCurrent(); await tx.fence();
      if (authority.action.parameters.operation === 'rollback') {
        effects = true;
        const stopped = await step('stop-previous', () => runtime.stopPrevious(tx.original.managedInference));
        check(stopped?.stopped === true, 'Previous native shutdown unconfirmed');
        await step('restore-baseline', () => runtime.restoreBaseline(baseline));
        await step('verify-baseline', () => runtime.verifyBaseline(baseline));
        await authority.assertCurrent(); await tx.select('docker');
        await authority.assertCurrent(); await tx.settle('rolled-back');
        return { status: 'rolled-back', settlement: 'confirmed' };
      }
      effects = true;
      await step('prepare-candidate', () => runtime.prepareCandidate(baseline));
      await step('drain-baseline', () => runtime.drainBaseline(baseline));
      await step('configure-candidate', () => runtime.configureCandidate(baseline));
      await step('verify-candidate', () => runtime.verifyCandidate(baseline));
      const stopped = await step('stop-candidate', () => runtime.stopCandidate());
      check(stopped?.stopped === true, 'Candidate shutdown unconfirmed');
      // Commit the selected profile while platform quiescence still prevents
      // new work, then start only that durably owned permanent service.
      await authority.assertCurrent(); await tx.select('native');
      await step('start-committed', () => runtime.startCommitted(baseline));
      const verified = await step('verify-committed', () => runtime.verifyCommitted(baseline));
      await authority.assertCurrent(); await tx.settle('active');
      return { status: 'active', settlement: 'confirmed', ...(verified?.evidence ? { activeIdentity: verified.evidence } : {}) };
    } catch (error) {
      try {
        if (effects) {
          // Cleanup is confined to this procedure's positively owned services.
          // A failed cleanup never grants permission to load Docker weights.
          const closed = await runtime.stopOwned();
          check(closed?.stopped === true, 'Native descendant cleanup unconfirmed');
        }
        await authority.assertCurrent();
        if (effects && authority.action.parameters.operation === 'activate') {
          await runtime.restoreBaseline(baseline); await authority.assertCurrent();
          await runtime.verifyBaseline(baseline); await authority.assertCurrent();
        } else check(!effects, 'Rollback effects require original-operation reconciliation');
        await tx.restore(); await tx.settle('failed-restored');
      } catch (cleanupError) {
        await tx.uncertain().catch(() => {});
        const uncertain = new Error('Native transition settlement unknown; request fence and operation lock retained', { cause: cleanupError });
        uncertain.nativeSettlement = 'unknown'; throw uncertain;
      }
      error.nativeSettlement = 'failed-restored';
      throw error;
    }
  });
}

export const NATIVE_CONTROLLER_CONTRACT = Object.freeze({ schemaVersion: 1, version: '1',
  actionType: 'inference.runtime.transition', operations: ['activate', 'rollback'], platform: 'darwin', architecture: 'arm64', minimumNode: '22.18.0' });

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--print-controller-contract') {
    process.stdout.write(JSON.stringify(NATIVE_CONTROLLER_CONTRACT) + '\n'); return;
  }
  const { values } = parseArgs({ strict: true, options: Object.fromEntries(
    ['state-directory', 'public-key', 'node-id', 'admission-file', 'baseline-engine'].map(name => [name, { type: 'string' }])) });
  for (const name of ['state-directory', 'public-key', 'node-id', 'admission-file', 'baseline-engine']) {
    check(values[name], 'Native installer configuration incomplete');
  }
  let authority, runtime, entered = false, authorityFenced = false;
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new Error('Native executor cancelled'));
  const fence = () => {
    authorityFenced = true; runtime?.fence(); cancellation.abort(new Error('Native admission fenced'));
  };
  for (const name of ['SIGINT', 'SIGTERM']) process.on(name, cancel);
  if (process.platform !== 'win32') process.on('SIGUSR1', fence);
  try {
    const chunks = []; let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length; check(length <= 16384, 'Native signed envelope exceeds limit'); chunks.push(chunk);
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const publicKey = createPublicKey(await readPackageManifest(values['public-key']));
    authority = await createTransitionAuthority({ envelope, publicKey, expectedNodeId: values['node-id'],
      readAdmission: async () => {
        // A renamed fresh snapshot may invalidate the read in progress. A
        // second read observes the same original action; it issues no action.
        try { return JSON.parse((await protectedRead(values['admission-file'])).toString()); }
        catch { return JSON.parse((await protectedRead(values['admission-file'])).toString()); }
      } });
    const store = createNativeTransitionStore({ stateDirectory: values['state-directory'] });
    runtime = createNativeRuntimeAdapter({ authority, stateDirectory: values['state-directory'],
      baselineEngine: values['baseline-engine'], signal: cancellation.signal });
    if (authorityFenced) runtime.fence();
    entered = true;
    const result = await executeManagedRuntimeTransition({ authority, store, runtime, signal: cancellation.signal });
    process.stdout.write(JSON.stringify({ ok: true, result, evidence: { schemaVersion: 1, actionKey: envelope.actionKey,
      requestDigest: authority.requestDigest, sourceSha: envelope.parameters.sourceSha, nativeStatus: result.status,
      settlement: result.settlement, ...(result.activeIdentity ? { activeIdentity: result.activeIdentity } : {}) } }) + '\n');
  } catch (error) {
    const status = error.nativeSettlement ?? (entered ? 'unknown' : 'not-started');
    process.stdout.write(JSON.stringify({ ok: false, errorCode: 'native_transition_failed',
      evidence: { schemaVersion: 1, nativeStatus: status === 'unknown' ? 'uncertain' : status,
        settlement: status === 'unknown' ? 'unknown' : 'confirmed',
        ...(authority ? { actionKey: authority.action.actionKey, requestDigest: authority.requestDigest, sourceSha: authority.action.parameters.sourceSha } : {}) } }) + '\n');
    process.exitCode = 1;
  } finally {
    for (const name of ['SIGINT', 'SIGTERM']) process.off(name, cancel);
    if (process.platform !== 'win32') process.off('SIGUSR1', fence);
  }
}
if (isEntryModule(import.meta.url)) main().catch(() => { process.stdout.write('{"ok":false,"errorCode":"native_configuration_invalid"}\n'); process.exitCode = 1; });
