import { instrumentOperationsReadClient } from "./operations-source-client";
import type {
  OperationsDegradedSource,
  OperationsSourceWatermark,
} from "./operations-snapshot";

export interface OperationsProjectionDiagnostics {
  degradedSources: OperationsDegradedSource[];
  sourceWatermarks: OperationsSourceWatermark[];
  queryCount: number;
  durationMs: number;
}

export function createOperationsLoadRuntime<T extends object>(input: {
  client: T;
  observedAt: string;
  clock: () => number;
}) {
  const startedAt = input.clock();
  let queryCount = 0;
  const diagnostics: OperationsProjectionDiagnostics = {
    degradedSources: [],
    sourceWatermarks: [],
    queryCount: 0,
    durationMs: 0,
  };
  const client = instrumentOperationsReadClient(input.client, () => {
    queryCount += 1;
  });

  function observe(source: string) {
    diagnostics.sourceWatermarks.push({ source, observedAt: input.observedAt });
  }

  async function read<TValue>(
    source: string,
    operation: Promise<TValue>,
    fallback: TValue,
  ): Promise<TValue> {
    try {
      const value = await operation;
      observe(source);
      return value;
    } catch {
      diagnostics.degradedSources.push({ source, reason: "query-failed" });
      return fallback;
    }
  }

  function unavailable(source: string) {
    diagnostics.degradedSources.push({ source, reason: "source-unavailable" });
  }

  function degrade(source: string, reason = "query-failed") {
    diagnostics.degradedSources.push({ source, reason });
  }

  function complete(): OperationsProjectionDiagnostics {
    diagnostics.degradedSources.sort((a, b) => a.source.localeCompare(b.source));
    diagnostics.sourceWatermarks.sort((a, b) => a.source.localeCompare(b.source));
    diagnostics.queryCount = queryCount;
    diagnostics.durationMs = Math.max(0, input.clock() - startedAt);
    return diagnostics;
  }

  return { client, read, observe, unavailable, degrade, complete };
}
