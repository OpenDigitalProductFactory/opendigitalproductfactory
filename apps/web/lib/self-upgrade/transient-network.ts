
// BI-224F56F1: implemented once in ../../../../scripts/lib/upgrade-source/transient-network.mjs so the
// promoter-image source writer and the portal share one definition.
import * as impl from "../../../../scripts/lib/upgrade-source/transient-network.mjs";

export const TRANSIENT_NETWORK_LINE: RegExp = impl.TRANSIENT_NETWORK_LINE;
export const isTransientNetworkFailure: (output: string) => boolean = impl.isTransientNetworkFailure;
export const transientNetworkLine: (output: string) => string | null = impl.transientNetworkLine;

export type TransientNetworkRetryOptions<T> = {
  /** Did this attempt fail? */
  failed: (result: T) => boolean;
  /** The text to inspect for a network cause. */
  output: (result: T) => string;
  /** Total attempts including the first. */
  attempts: number;
  /** Delay before retry n is baseDelayMs * n (linear backoff). */
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, cause: string) => void;
};

export const retryOnTransientNetwork: <T>(attempt: () => Promise<T>, options: TransientNetworkRetryOptions<T>) => Promise<T> =
  impl.retryOnTransientNetwork;
export const summarizeBuildOutput: (output: string, maxChars?: number) => string = impl.summarizeBuildOutput;
