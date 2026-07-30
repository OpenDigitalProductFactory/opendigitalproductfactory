import { request } from "node:http";

/**
 * @param {string} path
 * @param {typeof request} requestFactory
 * @param {number} timeoutMs
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export function boundedDockerSocketGet(
  path,
  requestFactory,
  timeoutMs,
  maxBytes,
) {
  return new Promise((resolve, reject) => {
    const req = requestFactory(
      {
        socketPath: "/var/run/docker.sock",
        path,
        method: "GET",
      },
      (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxBytes) {
            req.destroy(new Error("docker_engine_response_too_large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`docker_engine_http_${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(
      timeoutMs,
      () => req.destroy(new Error("docker_engine_timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}

/** @param {string} path */
export function dockerSocketGet(path) {
  return boundedDockerSocketGet(path, request, 5_000, 1024 * 1024);
}
