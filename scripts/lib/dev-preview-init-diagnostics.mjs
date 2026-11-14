export const PREVIEW_INIT_PREFIX = 'DPF_PREVIEW_INIT ';
const stepNames = ['install', 'generate', 'migrate', 'sanitize'];
const steps = new Set(stepNames);
const keys = ['version', 'step', 'state', 'category', 'exitCode'];

/** Accept categorical evidence only; never preserve arbitrary child fields. */
export function previewInitEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || value.version !== 1 || !steps.has(value.step)) return null;
  const valid = value.state === 'started' && value.category === 'running' && value.exitCode === null
    || value.state === 'passed' && value.category === 'success' && value.exitCode === 0
    || value.state === 'failed' && (value.category === 'exit' && Number.isInteger(value.exitCode)
      && value.exitCode > 0 && value.exitCode <= 255
      || ['signal', 'unavailable'].includes(value.category) && value.exitCode === null);
  return valid ? { version: 1, step: value.step, state: value.state,
    category: value.category, exitCode: value.exitCode } : null;
}

export function formatPreviewInitEvent(value) {
  const event = previewInitEvent(value);
  if (!event) throw new Error('preview_init_event_invalid');
  return PREVIEW_INIT_PREFIX + JSON.stringify(event);
}

/** One bounded line and at most eight records, independent of child output size. */
export function createPreviewInitEventReader(onEvent) {
  let bytes = [], oversized = false, count = 0, ordered = true;
  const finishLine = () => {
    if (!oversized) {
      const line = Buffer.from(bytes).toString('utf8').replace(/\r$/, '');
      if (line.startsWith(PREVIEW_INIT_PREFIX)) {
        let event;
        try { event = previewInitEvent(JSON.parse(line.slice(PREVIEW_INIT_PREFIX.length))); } catch {}
        if (event) {
          if (count >= 8) ordered = false;
          else {
            if (event.step !== stepNames[Math.floor(count / 2)]
                || event.state !== (count % 2 ? 'passed' : 'started')) ordered = false;
            count++; onEvent(event);
          }
        }
      }
    }
    bytes = []; oversized = false;
  };
  return {
    write(chunk) {
      for (const byte of Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) {
        if (byte === 10) { finishLine(); continue; }
        if (!oversized) {
          if (bytes.length === 1024) { bytes = []; oversized = true; }
          else bytes.push(byte);
        }
      }
    },
    finish: finishLine,
    get bufferedBytes() { return bytes.length; },
    get completed() { return ordered && count === 8; },
  };
}
