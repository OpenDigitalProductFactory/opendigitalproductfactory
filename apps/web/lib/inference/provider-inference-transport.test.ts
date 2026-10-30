import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { providerInferenceFetch, withInferenceCancellationFetch } from "./provider-inference-transport";
import { withInferenceCancellation } from "./inference-admission";

// Undici exports this clock specifically for tests. Advance its real HTTP
// parser timers while retaining real sockets, rather than waiting ten minutes.
const require = createRequire(import.meta.url);
const transportClock = require("undici/lib/util/timers.js") as {
  tick(milliseconds?: number): void;
};

async function withProvider(
  test: (url: string, dispatched: Promise<ServerResponse>) => Promise<void>,
) {
  let dispatched!: (response: ServerResponse) => void;
  const received = new Promise<ServerResponse>((resolve) => { dispatched = resolve; });
  const server = createServer((_request, response) => dispatched(response));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP listener");
  try {
    await test(`http://127.0.0.1:${address.port}/`, received);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

describe("provider inference transport deadlines", () => {
  it("combines the utility deadline with an adapter's longer signal", async () => {
    await withProvider(async (url, dispatched) => {
      const controller = new AbortController();
      const outcome = withInferenceCancellation(controller.signal, () =>
        providerInferenceFetch(url, { signal: AbortSignal.timeout(600_000) }))
        .catch((error: unknown) => error);
      await dispatched;
      controller.abort(new DOMException("utility deadline reached", "AbortError"));
      expect(await outcome).toMatchObject({ name: "AbortError" });
    });
  });

  it("accepts reviewer headers after the old five-minute transport cutoff", async () => {
    await withProvider(async (url, dispatched) => {
      const outcome = providerInferenceFetch(url, { signal: AbortSignal.timeout(600_000) })
        .then((response) => response.text()).catch((error: unknown) => error);
      const response = await dispatched;
      transportClock.tick();
      transportClock.tick(310_000);
      await setImmediate();
      response.end("independent review response");
      expect(await outcome).toBe("independent review response");
    });
  });

  it("accepts a delayed response body within the reviewer deadline", async () => {
    await withProvider(async (url, dispatched) => {
      const request = providerInferenceFetch(url, { signal: AbortSignal.timeout(600_000) });
      const response = await dispatched;
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("review ");
      const result = await request;
      const outcome = result.text().catch((error: unknown) => error);
      transportClock.tick();
      transportClock.tick(310_000);
      await setImmediate();
      response.end("complete");
      expect(await outcome).toBe("review complete");
    });
  });

  it("still stops a request at the caller's shorter deadline", async () => {
    await withProvider(async (url, dispatched) => {
      const controller = new AbortController();
      const outcome = providerInferenceFetch(url, { signal: controller.signal })
        .catch((error: unknown) => error);
      await dispatched;
      controller.abort(new DOMException("governed deadline reached", "TimeoutError"));
      expect(await outcome).toMatchObject({ name: "TimeoutError" });
    });
  });

  it("retains a finite transport ceiling when no caller signal is supplied", async () => {
    await withProvider(async (url, dispatched) => {
      const outcome = providerInferenceFetch(url).catch((error: unknown) => error);
      await dispatched;
      transportClock.tick();
      transportClock.tick(610_000);
      expect(await outcome).toMatchObject({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    });
  });

  it("retains the body timeout backstop after headers arrive", async () => {
    await withProvider(async (url, dispatched) => {
      const request = providerInferenceFetch(url);
      const response = await dispatched;
      response.writeHead(200);
      response.write("partial review");
      const result = await request;
      const outcome = result.text().catch((error: unknown) => error);
      transportClock.tick();
      transportClock.tick(610_000);
      expect(await outcome).toMatchObject({ cause: { code: "UND_ERR_BODY_TIMEOUT" } });
    });
  });

  it("honors caller cancellation while reading the body", async () => {
    await withProvider(async (url, dispatched) => {
      const controller = new AbortController();
      const request = providerInferenceFetch(url, { signal: controller.signal });
      const response = await dispatched;
      response.writeHead(200);
      response.write("partial review");
      const result = await request;
      const outcome = result.text().catch((error: unknown) => error);
      controller.abort(new DOMException("governed deadline reached", "TimeoutError"));
      expect(await outcome).toMatchObject({ name: "TimeoutError" });
    });
  });
});

// The governed path owns one finite transport for its admitted parent scope.
import { currentGovernedInferenceDeadline, withGovernedInferenceDeadline } from "@/lib/routing/governed-inference-deadline";

describe("parent-bound local inference transport", () => {
  it("stops a shorter caller when the transport's authority recheck hangs", async () => {
    let checks = 0;
    await withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 900_000).toISOString(),
      verifyAuthority: async () => ++checks === 1 ? true : new Promise<boolean>(() => {}) }, async () => {
      const caller = new AbortController();
      const parent = currentGovernedInferenceDeadline()!;
      const request = withInferenceCancellation(caller.signal, () =>
        withInferenceCancellationFetch(parent.localFetch)("http://127.0.0.1:1/")).catch(error => error);
      const reason = new Error("utility expired before transport dispatch");
      caller.abort(reason);
      expect(await request).toBe(reason);
      expect(parent.signal.aborted).toBe(false);
    });
  });

  it.each(["caller", "parent"])("honors %s cancellation on the governed local transport", async (source) => {
    expect(typeof withInferenceCancellationFetch).toBe("function");
    let authorized = true;
    await withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 900_000).toISOString(),
      verifyAuthority: async () => authorized }, async () => {
      await withProvider(async (url, dispatched) => {
        const caller = new AbortController();
        const scope = currentGovernedInferenceDeadline()!;
        const request = withInferenceCancellation(caller.signal, () =>
          withInferenceCancellationFetch(scope.localFetch)(url)).catch(error => error);
        await dispatched;
        if (source === "caller") caller.abort(new Error("utility expired"));
        else {
          authorized = false;
          await scope.assertAuthority().catch(() => undefined);
        }
        expect(await request).toBe(source === "caller" ? caller.signal.reason : scope.signal.reason);
      });
    });
  });

  it("accepts one real HTTP response beyond 600 seconds only inside the admitted window", async () => {
    await withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 900_000).toISOString(),
      verifyAuthority: async () => true }, async () => {
      await withProvider(async (url, dispatched) => {
        const outcome = currentGovernedInferenceDeadline()!.localFetch(url)
          .then(response => response.text()).catch(error => error);
        const response = await dispatched;
        transportClock.tick();
        transportClock.tick(610_000);
        await setImmediate();
        response.end("completed independent review");
        expect(await outcome).toBe("completed independent review");
      });
    });
  });

  it("retains a finite parser backstop within a governed activity", async () => {
    await withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 900_000).toISOString(),
      verifyAuthority: async () => true }, async () => {
      await withProvider(async (url, dispatched) => {
        const outcome = currentGovernedInferenceDeadline()!.localFetch(url).catch(error => error);
        await dispatched;
        transportClock.tick();
        transportClock.tick(910_000);
        expect(await outcome).toMatchObject({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
      });
    });
  });
});
