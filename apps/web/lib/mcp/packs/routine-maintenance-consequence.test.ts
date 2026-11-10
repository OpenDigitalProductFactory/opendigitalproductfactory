import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { resolveCallConsequence } from "@/lib/tool-consequence";
import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";
import { providerAccountDefinitions } from "./provider-account-tools";
import { adminPack } from "./admin-pack";

const provider = providerAccountDefinitions.find((tool) => tool.name === "manage_provider_account")!;
const command = adminPack.definitions.find((tool) => tool.name === "admin_run_command")!;

async function classify(tool: typeof provider, params: Record<string, unknown>) {
  return resolveCallConsequence(tool, { toolName: tool.name, params, userId: "owner" });
}

describe("routine maintenance uses the operation's actual effect", () => {
  it("discovers an explicit account's models without classifying catalog sync as new authority", async () => {
    expect((await classify(provider, { operation: "discover", connectionId: "account-a" })).consequence).toBeNull();
  });

  it.each(["add", "configure", "enable", "disable", "sign-in", "disconnect", "test", "unknown"])("retains the declared authority floor for %s", async (operation) => {
    expect((await classify(provider, { operation, connectionId: "account-a" })).consequence).toBe("authority");
  });

  it("does not refine an incomplete or credential-bearing discovery request", async () => {
    for (const params of [{ operation: "discover" }, { operation: "discover", connectionId: "" }, { operation: "discover", connectionId: "account-a", secretRef: "replacement" }]) {
      expect((await classify(provider, params)).consequence).toBe("authority");
    }
  });

  it.each(["docker compose ps --format json", "docker compose ps", "docker compose logs --tail 100 --no-color portal", "git status --short", "git rev-parse HEAD"])("recognizes the bounded diagnostic %s", async (value) => {
    expect((await classify(command, { command: value })).consequence).toBeNull();
  });

  it.each([
    "docker compose ps; pnpm run seed", "docker compose ps && git reset --hard",
    "docker compose ps | sh", "docker compose ps > file", "docker compose ps\npnpm run seed",
    "docker compose ps $(pnpm run seed)", "docker compose ps `pnpm run seed`",
    "docker compose --project-name peer ps", "docker compose -f other.yml ps",
    "docker compose ps --format {{.Status}}", "docker compose exec portal sh",
    "docker compose down --volumes", "git -c core.fsmonitor=evil status", "git status --help",
    "git push origin main", "pnpm run seed", "pnpm arbitrary-script", "",
  ])("keeps unknown, mutating or shell-composed commands consequential: %s", async (value) => {
    expect((await classify(command, { command: value })).consequence).toBe("irreversible");
  });

  it("uses existing delegation and never treats an environment name as authority", async () => {
    const consequence = (await classify(command, { command: "docker compose ps --format json", environmentClass: "development" })).consequence;
    const base = { action: { sideEffect: true, executionMode: "immediate" as const, consequence }, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true };
    expect(resolveEscalation({ ...base, steering: "connection-delegation" }).verdict).toBe("automated");
    expect(resolveEscalation({ ...base, steering: "none" }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", dataPolicy: { sensitivity: "restricted" } }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", action: { ...base.action, consequence: "authority" } }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", proposeBoundary: true }).verdict).toBe("human");
  });
});
