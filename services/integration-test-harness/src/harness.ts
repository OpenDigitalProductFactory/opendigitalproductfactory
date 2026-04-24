import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendHarnessAdminEvent } from "./admin-event-log.js";
import { applyScenarioControl, ControlApiError } from "./control-api.js";
import { createScenarioStateStore } from "./session-state.js";

const PORT = Number.parseInt(process.env.PORT ?? "8700", 10);
const HARNESS_TEST_MODE = process.env.HARNESS_TEST_MODE === "1";
const HARNESS_CONTROL_TOKEN = process.env.HARNESS_CONTROL_TOKEN ?? "";
const HARNESS_ADMIN_LOG_PATH = process.env.HARNESS_ADMIN_LOG_PATH ?? "/tmp/harness-admin-events.ndjson";

const state = createScenarioStateStore();

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: "integration-test-harness" });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/__control/scenario/")) {
    try {
      const parts = req.url.split("/").filter(Boolean);
      const vendor = parts[2] ?? "";
      const scenario = parts[3] ?? "";
      const rawBody = await readBody(req);
      const body = rawBody ? (JSON.parse(rawBody) as { sessionId?: string }) : {};
      const providedToken = req.headers["x-dpf-control-token"];

      const result = await applyScenarioControl(
        {
          vendor,
          scenario,
          sessionId: body.sessionId ?? "",
          providedToken: typeof providedToken === "string" ? providedToken : null,
        },
        {
          isTestMode: HARNESS_TEST_MODE,
          controlToken: HARNESS_CONTROL_TOKEN,
          state,
          logAdminEvent: (event) => appendHarnessAdminEvent(HARNESS_ADMIN_LOG_PATH, event),
        },
      );

      sendJson(res, 200, result);
      return;
    } catch (error) {
      if (error instanceof ControlApiError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      sendJson(res, 500, { error: "Internal server error" });
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[integration-test-harness] listening on :${PORT}`);
});
