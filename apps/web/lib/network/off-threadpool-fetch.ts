import { promises as dns, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_RESOLUTION_TIMEOUT_MS = 5_000;

export type CaresResolver = Readonly<{
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}>;

export type OffThreadpoolFetchTransport = Readonly<{
  fetch: typeof fetch;
  close(): Promise<void>;
}>;

type LookupDependencies = Readonly<{
  resolver?: CaresResolver;
  timeoutMs?: number;
}>;

type FetchTransportDependencies = LookupDependencies;

function resolutionError(
  code: "EAI_ADDRFAMILY" | "ENOTFOUND" | "ETIMEOUT",
  hostname: string,
): NodeJS.ErrnoException {
  return Object.assign(new Error(`off-threadpool DNS ${code.toLowerCase()} for ${hostname}`), {
    code,
    hostname,
    syscall: "query",
  });
}

function requestedFamily(family: LookupOptions["family"]): 0 | 4 | 6 | null {
  if (family === undefined || family === 0) return 0;
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return null;
}

function familyOrder(options: LookupOptions): ReadonlyArray<4 | 6> {
  const family = requestedFamily(options.family);
  if (family === 4 || family === 6) return [family];
  return options.order === "ipv6first" ? [6, 4] : [4, 6];
}

function waitUntil<T>(
  promise: Promise<T>,
  deadline: number,
  hostname: string,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return Promise.reject(resolutionError("ETIMEOUT", hostname));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(resolutionError("ETIMEOUT", hostname));
    }, remainingMs);
    timer.unref?.();

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function resolveFamily(
  resolver: CaresResolver,
  hostname: string,
  family: 4 | 6,
  deadline: number,
): Promise<LookupAddress[]> {
  const raw = family === 4
    ? await waitUntil(resolver.resolve4(hostname), deadline, hostname)
    : await waitUntil(resolver.resolve6(hostname), deadline, hostname);

  return raw
    .filter((address) => isIP(address) === family)
    .map((address) => ({ address, family }));
}

async function resolveHostnameWithDependencies(
  hostname: string,
  options: LookupOptions,
  dependencies: Required<LookupDependencies>,
): Promise<LookupAddress[]> {
  const literalFamily = isIP(hostname);
  const family = requestedFamily(options.family);
  if (family === null) throw resolutionError("EAI_ADDRFAMILY", hostname);
  if (literalFamily !== 0) {
    if (family !== 0 && family !== literalFamily) {
      throw resolutionError("EAI_ADDRFAMILY", hostname);
    }
    return [{ address: hostname, family: literalFamily }];
  }

  const deadline = Date.now() + dependencies.timeoutMs;
  const addresses: LookupAddress[] = [];
  let timedOut = false;

  for (const candidateFamily of familyOrder(options)) {
    try {
      const found = await resolveFamily(
        dependencies.resolver,
        hostname,
        candidateFamily,
        deadline,
      );
      addresses.push(...found);
      if (!options.all && addresses.length > 0) return addresses;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ETIMEOUT") timedOut = true;
    }
  }

  if (addresses.length > 0) return addresses;
  throw resolutionError(timedOut ? "ETIMEOUT" : "ENOTFOUND", hostname);
}

/** Resolve one hostname through c-ares without entering the libuv worker pool. */
export function resolveHostnameOffThreadpool(
  hostname: string,
  options: LookupOptions = {},
  dependencies: LookupDependencies = {},
): Promise<LookupAddress[]> {
  return resolveHostnameWithDependencies(hostname, options, {
    resolver: dependencies.resolver ?? dns,
    timeoutMs: dependencies.timeoutMs ?? DEFAULT_RESOLUTION_TIMEOUT_MS,
  });
}

/**
 * Node-compatible hostname lookup backed only by c-ares DNS queries.
 *
 * `dns.lookup` is intentionally not a fallback: it would re-enter the
 * process-global libuv worker queue this adapter exists to avoid.
 */
export function createOffThreadpoolLookup(
  dependencies: LookupDependencies = {},
): LookupFunction {
  return (hostname, options, callback) => {
    void resolveHostnameOffThreadpool(hostname, options, dependencies).then(
      (addresses) => {
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const [first] = addresses;
        if (!first) {
          callback(resolutionError("ENOTFOUND", hostname), "", 0);
          return;
        }
        callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

/** Create an explicitly owned Fetch transport whose hostname lookup avoids libuv. */
export function createOffThreadpoolFetchTransport(
  dependencies: FetchTransportDependencies = {},
): OffThreadpoolFetchTransport {
  const dispatcher = new Agent({
    connect: {
      lookup: createOffThreadpoolLookup(dependencies),
    },
  });
  const isolatedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>) as typeof fetch;

  return {
    fetch: isolatedFetch,
    close: async () => {
      await dispatcher.close();
    },
  };
}
