import { spawn } from 'node:child_process';
import { isEntryModule } from './entry-module.mjs';
import { formatPreviewInitEvent } from './dev-preview-init-diagnostics.mjs';

export const PREVIEW_INIT_STEPS = Object.freeze([
  { step: 'install', cwd: '/workspace', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { step: 'generate', cwd: '/workspace', command: 'pnpm', args: ['--filter', '@dpf/db', 'exec', 'prisma', 'generate'] },
  { step: 'migrate', cwd: '/workspace', command: 'pnpm', args: ['--filter', '@dpf/db', 'exec', 'node', './scripts/dev-preview-migrate-deploy.mjs'] },
  { step: 'sanitize', cwd: '/app', command: 'pnpm', args: ['--filter', '@dpf/db', 'exec', 'tsx', 'src/sanitized-clone.ts'] },
].map(spec => Object.freeze({ ...spec, args: Object.freeze(spec.args) })));

function runStep(spec) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: process.env,
        stdio: ['ignore', 'ignore', 'ignore'] });
    } catch { resolve({ category: 'unavailable', exitCode: null }); return; }
    child.once('error', () => resolve({ category: 'unavailable', exitCode: null }));
    child.once('close', code => resolve(code === 0 ? { category: 'success', exitCode: 0 }
      : Number.isInteger(code) && code > 0 && code <= 255 ? { category: 'exit', exitCode: code }
        : { category: 'signal', exitCode: null }));
  });
}

/** The CLI always runs the fixed commands; injected steps are for source-local tests. */
export async function runPreviewInitialization({ steps = PREVIEW_INIT_STEPS,
  emit = line => process.stdout.write(line + '\n'), run = runStep } = {}) {
  if (steps.length !== PREVIEW_INIT_STEPS.length
      || steps.some((spec, index) => spec.step !== PREVIEW_INIT_STEPS[index].step)) {
    throw new Error('preview_init_steps_invalid');
  }
  for (const spec of steps) {
    emit(formatPreviewInitEvent({ version: 1, step: spec.step, state: 'started', category: 'running', exitCode: null }));
    const result = await run(spec);
    emit(formatPreviewInitEvent({ version: 1, step: spec.step,
      state: result.category === 'success' ? 'passed' : 'failed', ...result }));
    if (result.category !== 'success') return result.exitCode ?? 1;
  }
  return 0;
}

if (isEntryModule(import.meta.url)) {
  try { process.exitCode = await runPreviewInitialization(); }
  catch { console.error('preview_initialization_unavailable'); process.exitCode = 1; }
}
