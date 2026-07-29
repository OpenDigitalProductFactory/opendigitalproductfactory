import {
  loadLivingBusinessProjection,
  type LivingBusinessLoadOptions,
} from "./living-business-snapshot";
import {
  createVersionedOperationsSnapshot,
  type VersionedOperationsSnapshot,
} from "./operations-snapshot";

function attachExactPayloadBytes(
  snapshot: VersionedOperationsSnapshot,
): VersionedOperationsSnapshot {
  let payloadBytes = snapshot.telemetry.payloadBytes;
  let measured = snapshot;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    measured = {
      ...snapshot,
      telemetry: { ...snapshot.telemetry, payloadBytes },
    };
    const next = new TextEncoder().encode(JSON.stringify(measured)).byteLength;
    if (next === payloadBytes) return measured;
    payloadBytes = next;
  }
  return {
    ...snapshot,
    telemetry: { ...snapshot.telemetry, payloadBytes },
  };
}

export async function loadVersionedOperationsSnapshot(
  opts?: LivingBusinessLoadOptions,
): Promise<VersionedOperationsSnapshot | null> {
  const loaded = await loadLivingBusinessProjection(opts);
  if (!loaded) return null;
  const snapshot = createVersionedOperationsSnapshot({
    identity: {
      archetypeId: loaded.twin.archetypeId,
      archetypeName: loaded.twin.archetypeName,
      template: loaded.twin.template,
    },
    twin: loaded.twin,
    asOf: (opts?.now ?? new Date()).toISOString(),
    sourceWatermarks: loaded.diagnostics.sourceWatermarks,
    degradedSources: loaded.diagnostics.degradedSources,
    telemetry: {
      durationMs: loaded.diagnostics.durationMs,
      queryCount: loaded.diagnostics.queryCount,
      payloadBytes: 0,
    },
  });
  return attachExactPayloadBytes(snapshot);
}
