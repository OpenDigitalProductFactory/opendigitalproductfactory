import { request } from "node:http";

/**
 * @param {string} path
 * @param {typeof request} requestFactory
 * @param {number} timeoutMs
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
function boundedDockerRequest(path, method, requestFactory, timeoutMs, maxBytes, stopping = false) {
  return new Promise((resolve, reject) => {
    let req, deadline, settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(new Error(message));
      try { req?.destroy(); } catch { /* Original controlled failure wins. */ }
    };
    try { req = requestFactory(
      {
        socketPath: "/var/run/docker.sock",
        path,
        method,
      },
      (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        response.on("error", () => fail("docker_engine_response_unavailable"));
        response.on("aborted", () => fail("docker_engine_response_unavailable"));
        response.on("data", (chunk) => {
          if (settled) return;
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxBytes) {
            fail("docker_engine_response_too_large");
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          const status = response.statusCode ?? 500;
          if (status >= 400) {
            fail(`docker_engine_http_${status}`);
            return;
          }
          if (stopping) {
            if (status !== 204 && status !== 304) { fail("docker_engine_stop_response_unverified"); return; }
            settled = true; clearTimeout(deadline); resolve(undefined); return;
          }
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            settled = true; clearTimeout(deadline); resolve(value);
          } catch {
            fail("docker_engine_response_invalid");
          }
        });
      },
    );
    req.on("error", () => fail("docker_engine_unavailable"));
    req.setTimeout(
      timeoutMs,
      () => fail("docker_engine_timeout"),
    );
    // Idle socket timeouts alone do not bound a slowly streaming response.
    deadline = setTimeout(() => fail("docker_engine_timeout"), timeoutMs);
    req.end();
    } catch { fail("docker_engine_unavailable"); }
  });
}

export function boundedDockerSocketGet(path, requestFactory, timeoutMs, maxBytes) {
  return boundedDockerRequest(path, "GET", requestFactory, timeoutMs, maxBytes);
}

/** Fixed operation only; names, URLs, command strings and partial IDs refuse. */
export function boundedDockerSocketStop(containerId, requestFactory, timeoutMs = 10_000, maxBytes = 1024) {
  if (typeof containerId !== "string" || !/^[a-f0-9]{64}$/.test(containerId)) {
    return Promise.reject(new Error("docker_engine_stop_identity_invalid"));
  }
  return boundedDockerRequest(`/containers/${containerId}/stop?t=5`, "POST", requestFactory, timeoutMs, maxBytes, true);
}

export function dockerSocketStop(containerId) {
  return boundedDockerSocketStop(containerId, request);
}

/** @param {string} path */
export function dockerSocketGet(path) {
  return boundedDockerSocketGet(path, request, 5_000, 1024 * 1024);
}
