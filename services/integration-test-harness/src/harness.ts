import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { appendHarnessAdminEvent } from "./admin-event-log.js";
import { applyScenarioControl, ControlApiError } from "./control-api.js";
import { createScenarioStateStore } from "./session-state.js";
import type { HarnessScenarioFixture, LoadedVendorDefinition, ScenarioStateStore } from "./types.js";
import { loadScenarioFixture, loadVendors } from "./vendor-registry.js";

const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? "8700", 10);
const DEFAULT_VENDOR_ROOT = join(import.meta.dirname, "..", "vendors");

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendResponse(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    ...headers,
    "content-length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  sendResponse(res, status, JSON.stringify(body), {
    "content-type": "application/json",
  });
}

export interface HarnessRuntimeConfig {
  port: number;
  isTestMode: boolean;
  controlToken: string;
  adminLogPath: string;
  vendorRoot: string;
  state: ScenarioStateStore;
}

export async function createHarnessServer(
  config: Partial<HarnessRuntimeConfig> = {},
): Promise<Server> {
  const runtimeConfig: HarnessRuntimeConfig = {
    port: config.port ?? DEFAULT_PORT,
    isTestMode: config.isTestMode ?? process.env.HARNESS_TEST_MODE === "1",
    controlToken: config.controlToken ?? process.env.HARNESS_CONTROL_TOKEN ?? "",
    adminLogPath:
      config.adminLogPath ?? process.env.HARNESS_ADMIN_LOG_PATH ?? "/tmp/harness-admin-events.ndjson",
    vendorRoot: config.vendorRoot ?? DEFAULT_VENDOR_ROOT,
    state: config.state ?? createScenarioStateStore(),
  };

  const vendors = await loadVendors(runtimeConfig.vendorRoot);

  return createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://integration-test-harness.local");

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "integration-test-harness" });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname.startsWith("/__control/scenario/")) {
      try {
        const parts = requestUrl.pathname.split("/").filter(Boolean);
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
            isTestMode: runtimeConfig.isTestMode,
            controlToken: runtimeConfig.controlToken,
            state: runtimeConfig.state,
            logAdminEvent: (event) => appendHarnessAdminEvent(runtimeConfig.adminLogPath, event),
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

    const matchedRoute = findMatchingRoute(vendors, req.method ?? "GET", requestUrl.pathname);
    if (!matchedRoute) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const sessionId = normalizeHeaderValue(req.headers["x-dpf-harness-session"]);
    const activeScenario = runtimeConfig.state.getScenario(matchedRoute.vendor.slug, sessionId) ?? "happy-path";

    try {
      const fixture = await loadScenarioFixture(matchedRoute.vendor, activeScenario);
      const response = fixture[matchedRoute.route.key];
      if (!response) {
        sendJson(res, 500, {
          error: `Scenario '${activeScenario}' does not define route '${matchedRoute.route.key}'`,
        });
        return;
      }

      sendFixtureResponse(res, response);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      sendJson(res, 500, { error: message });
    }
  });
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

function findMatchingRoute(
  vendors: LoadedVendorDefinition[],
  method: string,
  pathname: string,
): { vendor: LoadedVendorDefinition; route: LoadedVendorDefinition["routes"][number] } | null {
  for (const vendor of vendors) {
    for (const route of vendor.routes) {
      if (route.method !== method) continue;
      if (matchesRoutePath(route.path, pathname)) {
        return { vendor, route };
      }
    }
  }

  return null;
}

function matchesRoutePath(template: string, actualPath: string): boolean {
  const templateSegments = template.split("/").filter(Boolean);
  const actualSegments = actualPath.split("/").filter(Boolean);

  if (templateSegments.length !== actualSegments.length) {
    return false;
  }

  return templateSegments.every((segment, index) => {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      return actualSegments[index] !== undefined;
    }
    return segment === actualSegments[index];
  });
}

function sendFixtureResponse(res: ServerResponse, response: HarnessScenarioFixture[string]): void {
  if (typeof response.rawBody === "string") {
    sendResponse(res, response.status, response.rawBody, response.headers);
    return;
  }

  sendResponse(res, response.status, JSON.stringify(response.body ?? {}), {
    "content-type": "application/json",
    ...response.headers,
  });
}

async function startHarnessFromCli(): Promise<void> {
  const server = await createHarnessServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`[integration-test-harness] listening on :${DEFAULT_PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startHarnessFromCli();
}
