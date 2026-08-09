import https from "node:https";

export type UnifiFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export function createUnifiFetch(tlsInsecure: boolean): UnifiFetch {
  // UniFi appliances commonly use self-signed certificates. Validation is
  // disabled only through an explicit per-connection or legacy operator opt-in.
  const allowInsecure = tlsInsecure || process.env.UNIFI_ALLOW_INSECURE_TLS === "true";
  const agent = new https.Agent({ rejectUnauthorized: !allowInsecure });
  if (allowInsecure) {
    console.warn(
      "[unifi] TLS cert validation disabled for this connection. " +
        "Acceptable for self-signed UniFi controllers; rotate to a valid cert in production.",
    );
  }

  return (url, init) =>
    new Promise((resolve, reject) => {
      const parsedUrl = new URL(String(url));
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
          headers[key] = value;
        }
      }
      const request = https.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: init?.method ?? "GET",
          agent,
          headers,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => {
            resolve(new Response(body, {
              status: response.statusCode ?? 500,
              headers: (response.headers ?? {}) as Record<string, string>,
            }));
          });
        },
      );
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          request.destroy();
          reject(new Error("aborted"));
        });
      }
      request.on("error", reject);
      request.end();
    });
}
