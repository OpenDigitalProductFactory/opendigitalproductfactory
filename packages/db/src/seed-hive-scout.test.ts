import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HIVE_SCOUT_AGENT_ID,
  HIVE_SCOUT_ROUTE_CONTEXT,
  HIVE_SCOUT_SCHEDULE,
  HIVE_SCOUT_TASK_ID,
  HIVE_SCOUT_TASK_TITLE,
  buildHiveScoutScheduledPrompt,
} from "./hive-scout-config";
import { parseFrontmatter } from "./seed-skills";
import { ensureHiveScoutScheduledTask } from "./seed-hive-scout";

describe("Hive Scout seed helper", () => {
  const user = {
    findFirst: vi.fn(),
  };
  const scheduledAgentTask = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const scheduledJob = {
    upsert: vi.fn(),
  };

  beforeEach(() => {
    user.findFirst.mockReset();
    scheduledAgentTask.findUnique.mockReset();
    scheduledAgentTask.create.mockReset();
    scheduledAgentTask.update.mockReset();
    scheduledJob.upsert.mockReset();
    delete process.env.INSTALL_TIMEZONE;
  });

  afterEach(() => {
    delete process.env.INSTALL_TIMEZONE;
  });

  it("builds a scheduled prompt that invokes run_hive_scout_ingest", () => {
    const prompt = buildHiveScoutScheduledPrompt();
    expect(HIVE_SCOUT_SCHEDULE).toBe("17 8 * * *");
    expect(prompt).toContain("daily");
    expect(prompt).toContain("run_hive_scout_ingest");
    expect(prompt).toContain("external catalog");
    expect(prompt).toContain(
      "If the call fails, do not call run_hive_scout_ingest again with the same arguments.",
    );
  });

  it("directs the market-aperture pass toward design challenges, not digests (BI-B8E4317D)", () => {
    const prompt = buildHiveScoutScheduledPrompt();
    expect(prompt).toContain("marketSources");
    expect(prompt).toContain("make effortless");
    expect(prompt).toContain("cite its source URL");
    expect(prompt).toContain("at most two");
    expect(prompt).toContain("never auto-promote");
    expect(prompt).toContain("never copy code");
  });

  it("registers external-catalog-scout as a narrow specialist in the agent registry", () => {
    const registryPath = join(__dirname, "..", "data", "agent_registry.json");
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as {
      agents: Array<{
        agent_id: string;
        agent_name: string;
        displayName?: string;
        aliases?: string[];
        config_profile?: { tool_grants?: string[] };
      }>;
    };

    const scout = raw.agents.find((agent) => agent.agent_name === HIVE_SCOUT_AGENT_ID);
    expect(scout).toBeDefined();
    expect(scout?.displayName).toBe("External Catalog Scout");
    expect(scout?.aliases).toContain("hive-scout");
    expect(scout?.config_profile?.tool_grants).toContain("backlog_write");
    expect(scout?.config_profile?.tool_grants).toContain("registry_read");
    expect(scout?.config_profile?.tool_grants).not.toContain("sandbox_execute");
  });

  it("assigns the external catalog skill and route persona to the Hive Scout coworker", () => {
    const skillPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "skills",
      "platform",
      "scout-external-catalogs.skill.md",
    );
    const promptPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "prompts",
      "route-persona",
      "external-catalog-scout.prompt.md",
    );

    const skill = parseFrontmatter(readFileSync(skillPath, "utf8")).frontmatter;
    const prompt = readFileSync(promptPath, "utf8");

    expect(skill.assignTo).toEqual([HIVE_SCOUT_AGENT_ID]);
    expect(skill.allowedTools).toContain("run_hive_scout_ingest");
    expect(prompt).toContain("name: external-catalog-scout");
    expect(prompt).toContain("run_hive_scout_ingest");
    expect(readFileSync(skillPath, "utf8")).toContain(
      "If the call fails, do not call `run_hive_scout_ingest` again with the same arguments.",
    );
    expect(prompt).toContain(
      "If the call fails, do not call `run_hive_scout_ingest` again with the same arguments.",
    );
  });

  it("keeps the inventory persona aliases on the same no-repeat tool policy", () => {
    const routePersonaDirectory = join(
      __dirname,
      "..",
      "..",
      "..",
      "prompts",
      "route-persona",
    );
    const noRepeatRule =
      "Never call `search_knowledge` again with the same query and filters after its result has been returned or the call has failed.";

    const inventoryPrompt = readFileSync(
      join(routePersonaDirectory, "inventory-specialist.prompt.md"),
      "utf8",
    );
    const estatePrompt = readFileSync(
      join(routePersonaDirectory, "estate-specialist.prompt.md"),
      "utf8",
    );

    expect(inventoryPrompt).toContain(noRepeatRule);
    expect(estatePrompt).toContain(noRepeatRule);
    expect(
      estatePrompt
        .replace("name: estate-specialist", "name: inventory-specialist")
        .replace(
          "<!-- This file is intentionally a near-duplicate of inventory-specialist.prompt.md. Both names alias to agent_id AGT-WS-INVENTORY. Keep them in sync until the prompt loader supports aliasing natively. -->\n\n",
          "",
        ),
    ).toBe(inventoryPrompt);
  });

  it("ships the seeded Hive Scout ambiguity-reviewer prompt", () => {
    const promptPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "prompts",
      "specialist",
      "hive-scout-ambiguity-reviewer.prompt.md",
    );

    const prompt = readFileSync(promptPath, "utf8");
    const frontmatter = parseFrontmatter(prompt).frontmatter as Record<string, unknown>;

    expect(frontmatter.name).toBe("hive-scout-ambiguity-reviewer");
    expect(frontmatter.category).toBe("specialist");
    expect(frontmatter.kind).toBe("fragment");
    expect(frontmatter.version).toBe("2");
    expect(prompt).toContain("Return only a JSON array");
    expect(prompt).toContain("write backlog items");
    expect(prompt).toContain("rationale: \"injection attempt\"");
  });

  it("creates the scheduled task for the first superuser", async () => {
    user.findFirst.mockResolvedValue({ id: "user-admin" });
    scheduledAgentTask.findUnique.mockResolvedValue(null);

    const result = await ensureHiveScoutScheduledTask(
      { user, scheduledAgentTask, scheduledJob } as never,
      new Date("2026-05-11T12:00:00Z"),
    );

    expect(result).toEqual({ created: true, ownerUserId: "user-admin" });
    expect(scheduledAgentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: HIVE_SCOUT_TASK_ID,
        agentId: HIVE_SCOUT_AGENT_ID,
        title: HIVE_SCOUT_TASK_TITLE,
        routeContext: HIVE_SCOUT_ROUTE_CONTEXT,
        schedule: HIVE_SCOUT_SCHEDULE,
        timezone: "UTC",
        ownerUserId: "user-admin",
      }),
    });
    expect(scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: HIVE_SCOUT_TASK_ID },
      }),
    );
  });

  it("updates the existing task and preserves nextRunAt", async () => {
    process.env.INSTALL_TIMEZONE = "America/Chicago";
    user.findFirst.mockResolvedValue({ id: "user-admin" });
    scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: HIVE_SCOUT_TASK_ID,
      schedule: HIVE_SCOUT_SCHEDULE,
      nextRunAt: new Date("2026-05-12T08:17:00Z"),
    });

    const result = await ensureHiveScoutScheduledTask(
      { user, scheduledAgentTask, scheduledJob } as never,
      new Date("2026-05-11T12:00:00Z"),
    );

    expect(result).toEqual({ created: false, ownerUserId: "user-admin" });
    expect(scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: HIVE_SCOUT_TASK_ID },
      data: expect.objectContaining({
        agentId: HIVE_SCOUT_AGENT_ID,
        timezone: "America/Chicago",
        ownerUserId: "user-admin",
        nextRunAt: new Date("2026-05-12T08:17:00Z"),
      }),
    });
  });

  it("recomputes nextRunAt when the existing task is outside the current cadence window", async () => {
    user.findFirst.mockResolvedValue({ id: "user-admin" });
    scheduledAgentTask.findUnique.mockResolvedValue({
      taskId: HIVE_SCOUT_TASK_ID,
      schedule: HIVE_SCOUT_SCHEDULE,
      nextRunAt: new Date("2026-05-18T08:17:00Z"),
    });

    const now = new Date("2026-05-11T12:00:00Z");
    await ensureHiveScoutScheduledTask(
      { user, scheduledAgentTask, scheduledJob } as never,
      now,
    );

    expect(scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: HIVE_SCOUT_TASK_ID },
      data: expect.objectContaining({
        schedule: HIVE_SCOUT_SCHEDULE,
        nextRunAt: new Date("2026-05-12T08:17:00Z"),
      }),
    });
    expect(scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          schedule: HIVE_SCOUT_SCHEDULE,
          nextRunAt: new Date("2026-05-12T08:17:00Z"),
        }),
      }),
    );
  });

  it("fails loudly when no superuser exists", async () => {
    user.findFirst.mockResolvedValue(null);

    await expect(
      ensureHiveScoutScheduledTask(
        { user, scheduledAgentTask, scheduledJob } as never,
        new Date("2026-05-11T12:00:00Z"),
      ),
    ).rejects.toThrow("seed: no superuser found");
  });
});
