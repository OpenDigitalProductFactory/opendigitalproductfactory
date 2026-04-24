import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { HarnessAdminEvent } from "./types.js";

export async function appendHarnessAdminEvent(
  logPath: string,
  event: HarnessAdminEvent,
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}
