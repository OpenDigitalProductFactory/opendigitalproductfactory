import { fenceEndedPreviewRuntimesAtDaemon } from "../nonprod/preview-runtime-fence";

async function main() {
  const { serveScopeWriterObserver } = await import("../../../../scripts/promoter-epoch-evidence.mjs");
  let previewPass: ReturnType<typeof fenceEndedPreviewRuntimesAtDaemon> | undefined;
  await serveScopeWriterObserver(process.env, () => {
    previewPass ??= fenceEndedPreviewRuntimesAtDaemon().finally(() => { previewPass = undefined; });
    return previewPass;
  });
}

void main().catch(() => {
  process.stderr.write("portal_actuator_startup_unavailable\n");
  process.exitCode = 78;
});
