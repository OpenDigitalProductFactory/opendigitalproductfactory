type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = found?.[1];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseRetryAfterSeconds(headers: HeaderBag, now: Date = new Date()): number | null {
  const retryAfter = readHeader(headers, "retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, Math.ceil((dateMs - now.getTime()) / 1000));
  }

  const reset = readHeader(headers, "x-ratelimit-reset") ?? readHeader(headers, "x-rate-limit-reset");
  if (reset) {
    const epoch = Number.parseInt(reset, 10);
    if (Number.isFinite(epoch)) return Math.max(0, epoch - Math.floor(now.getTime() / 1000));
  }

  return null;
}
