// Transient network failures during a self-upgrade (BI-7FFF5CB0).
//
// A self-upgrade makes outbound fetches the running portal cannot avoid: the
// upstream `git fetch`, the base-image pull and the `apk add` inside the
// candidate promoter/portal builds. On a host whose network drops connections
// for a few seconds, one failed fetch used to fail the whole upgrade
// (SUR-256EAF95 at git fetch; SUR-B0A4610D / SUR-FF879116 at apk add), and
// the identical command succeeded on rerun.
//
// These helpers retry ONLY failures whose output names a network cause. A real
// defect (missing package, bad ref, lockfile drift) is never retried, so a
// retry can never hide one.

/**
 * Output signatures of a network fetch that failed for a transient reason.
 * Anchored on the tools' own phrasing (apk, git/curl, Go net/http, buildkit),
 * never on a bare "error" or exit code.
 */
const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  // apk-tools
  /network error \(check Internet connectivity/i,
  /temporary error \(try again later\)/i,
  /DNS lookup error/i,
  // git / curl
  /Failed to connect to \S+ port \d+/i,
  /Could not connect to server/i,
  /Could not resolve host/i,
  /Connection timed out/i,
  /Operation timed out/i,
  /Connection reset by peer/i,
  /the remote end hung up unexpectedly/i,
  /\bearly EOF\b/i,
  /RPC failed; curl \d+/i,
  /SSL_ERROR_SYSCALL/i,
  /gnutls_handshake\(\) failed/i,
  // Go net/http (docker, buildkit)
  /\bi\/o timeout\b/i,
  /TLS handshake timeout/i,
  /net\/http: request canceled while waiting for connection/i,
  /dial tcp: lookup \S+.*(no such host|server misbehaving|timeout)/i,
];

/** One regex matching any line that names a transient network cause. */
export const TRANSIENT_NETWORK_LINE = new RegExp(
  TRANSIENT_NETWORK_PATTERNS.map((re) => `(?:${re.source})`).join("|"),
  "i",
);

export function isTransientNetworkFailure(output: string): boolean {
  if (!output) return false;
  return TRANSIENT_NETWORK_PATTERNS.some((re) => re.test(output));
}

/** The first output line that names a network cause, if any. */
export function transientNetworkLine(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (TRANSIENT_NETWORK_PATTERNS.some((re) => re.test(line))) return line.trim();
  }
  return null;
}

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

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt` until it succeeds, fails for a non-network reason, or runs out
 * of attempts. Returns the last result; the caller decides what a failure means.
 */
export async function retryOnTransientNetwork<T>(
  attempt: () => Promise<T>,
  options: TransientNetworkRetryOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let result = await attempt();
  for (let n = 1; n < options.attempts; n++) {
    if (!options.failed(result)) return result;
    const text = options.output(result);
    if (!isTransientNetworkFailure(text)) return result;
    options.onRetry?.(n, transientNetworkLine(text) ?? "network failure");
    const delay = options.baseDelayMs * n;
    if (delay > 0) await sleep(delay);
    result = await attempt();
  }
  return result;
}

/**
 * Condense build output for a persisted failure message. A plain tail cut
 * SUR-FF879116's apk network error down to "ty."; this keeps the lines that
 * name the cause (network, ERROR, exit code) plus the final lines.
 */
export function summarizeBuildOutput(output: string, maxChars = 1200): string {
  const lines = output.trim().split(/\r?\n/);
  const causes = lines.filter((l) =>
    TRANSIENT_NETWORK_PATTERNS.some((re) => re.test(l))
    || /\bERROR\b|\berror:|no such package|exit code: \d+/i.test(l));
  const tail = lines.slice(-4);
  const picked: string[] = [];
  for (const line of [...causes.slice(0, 6), ...tail]) {
    if (!picked.includes(line)) picked.push(line);
  }
  const text = picked.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
