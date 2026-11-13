import { describe, expect, it } from "vitest";
import registry from "../data/agent_registry.json";
import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG } from "./agent-identity";
import { assertInteractiveAgentPermissionState, seedCanonicalAgentToolGrants,
  type CanonicalGrantSeedDb, type SeedAgentPermissionState } from "./seed-agent-tool-grants";
import { COWORKER_AGENT_SEEDS } from "./workforce-seed";

const profiles = ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"];
const defaults = (id: string) => registry.agents.find(agent => agent.agent_id === id)!.config_profile.tool_grants;
type Grant = { agentId: string; grantKey: string; grantedBy: string | null; grantedAt: Date };
function fixture() {
  const agents = new Map<string, string>();
  for (const id of profiles) {
    agents.set(id, `row:${id}`);
    const alias = CANONICAL_AGENT_ID_TO_COWORKER_SLUG[id];
    agents.set(alias, `row:${alias}`);
  }
  const grants = new Map<string, Grant>(), revocations = new Set<string>();
  const key = (id: string, grant: string) => `${id}:${grant}`;
  const db: CanonicalGrantSeedDb = {
    agent: { async findUnique({ where }) {
      const id = agents.get(where.agentId);
      return id ? { _count: {
        toolGrants: [...grants.values()].filter(row => row.agentId === id).length,
        toolGrantRevocations: [...revocations].filter(row => row.startsWith(`${id}:`)).length,
      } } : null;
    } },
    agentToolGrant: { async upsert(input) {
      const { agentId, grantKey } = input.where.agentId_grantKey;
      const compound = key(agentId, grantKey), previous = grants.get(compound);
      if (previous) { Object.assign(previous, input.update); return previous; }
      const row = { ...input.create, grantedBy: null, grantedAt: new Date("2026-10-07T00:00:00Z") };
      grants.set(compound, row); return row;
    } },
  };
  const agent = (id: string) => ({ id: agents.get(id)!, agentId: id });
  const held = (id: string) => [...grants.values()].filter(row => row.agentId === agents.get(id)).map(row => row.grantKey).sort();
  return { db, agents, grants, revocations, key, agent, held };
}

describe("canonical registry grant convergence", () => {
  it.each(profiles)("fresh %s can discover and request review services without administrative authority", async id => {
    const f = fixture();
    await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    expect(f.held(id)).toEqual([...defaults(id)].sort());
    expect(f.held(id)).toContain("coworker_catalog_read");
    expect(f.held(id)).toContain("coworker_engagement_write");
    expect(f.held(id)).not.toContain("admin_write");
    expect(f.held(id)).not.toContain("iac_execute");
    expect(f.held(CANONICAL_AGENT_ID_TO_COWORKER_SLUG[id])).toEqual([]);
  });
  it("fills an upgraded profile and leaves existing and unrelated grant provenance intact on rerun", async () => {
    const f = fixture(), id = "AGT-EXT-CODEX", rowId = f.agent(id).id;
    const original = { agentId: rowId, grantKey: "registry_read", grantedBy: "operator", grantedAt: new Date("2025-01-01") };
    const custom = { ...original, grantKey: "release_plan_read" };
    f.grants.set(f.key(rowId, original.grantKey), { ...original });
    f.grants.set(f.key(rowId, custom.grantKey), { ...custom });
    await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    expect(f.held(id)).toContain("coworker_catalog_read");
    expect(f.held(id)).toContain("coworker_engagement_write");
    expect(f.grants.get(f.key(rowId, original.grantKey))).toEqual(original);
    expect(f.grants.get(f.key(rowId, custom.grantKey))).toEqual(custom);
    const before = structuredClone([...f.grants]);
    await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    expect([...f.grants]).toEqual(before);
  });
  it.each(profiles)("preserves an explicit %s removal across seed reruns", async id => {
    const f = fixture();
    const removal = f.key(f.agent(id).id, "coworker_engagement_write");
    f.revocations.add(removal);
    await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    expect(f.held(id)).toContain("coworker_catalog_read");
    expect(f.held(id)).not.toContain("coworker_engagement_write");
    expect([...f.revocations]).toEqual([removal]);
  });
  it.each(["grant", "revocation"])("an alias %s postpones only its own identity's defaults", async kind => {
    const f = fixture(), alias = CANONICAL_AGENT_ID_TO_COWORKER_SLUG["AGT-EXT-CODEX"], aliasId = f.agent(alias).id;
    if (kind === "grant") f.grants.set(f.key(aliasId, "backlog_write"), { agentId: aliasId, grantKey: "backlog_write", grantedBy: "previous", grantedAt: new Date("2025-01-01") });
    else f.revocations.add(f.key(aliasId, "backlog_write"));
    const assertions = structuredClone({ grants: [...f.grants], revocations: [...f.revocations] });
    for (const id of profiles) await seedCanonicalAgentToolGrants(f.db, f.agent(id), defaults(id), f.revocations);
    expect(f.held("AGT-EXT-CODEX")).toEqual([]);
    expect(f.held("AGT-EXT-CLAUDE")).toContain("coworker_engagement_write");
    expect(f.held("AGT-EXT-GROK")).toContain("coworker_engagement_write");
    expect([...f.grants].filter(([, row]) => row.agentId === aliasId)).toEqual(assertions.grants);
    expect([...f.revocations]).toEqual(assertions.revocations);
  });
  it("never recreates grants on an execution alias", async () => {
    const f = fixture(), alias = CANONICAL_AGENT_ID_TO_COWORKER_SLUG["AGT-EXT-CODEX"];
    await seedCanonicalAgentToolGrants(f.db, f.agent(alias), defaults("AGT-EXT-CODEX"), f.revocations);
    expect([...f.grants]).toEqual([]);
  });
});

describe("interactive seed permission invariant", () => {
  const row = (agentId: string, grants = 0, revocations = 0, type = "coworker"): SeedAgentPermissionState => ({
    agentId, name: agentId, type, _count: { toolGrants: grants, toolGrantRevocations: revocations },
  });
  const check = (rows: SeedAgentPermissionState[]) =>
    assertInteractiveAgentPermissionState({ agent: { async findMany() { return rows; } } });

  it("accepts the fresh registry and complete coworker roster without duplicate alias grants", async () => {
    const canonical = registry.agents.map(agent => row(agent.agent_id,
      agent.config_profile.tool_grants.length, 0, "specialist"));
    const aliases = COWORKER_AGENT_SEEDS.map(agent => row(agent.agentId));
    await expect(check([...canonical, ...aliases])).resolves.toBeUndefined();
  });

  it("rejects a missing canonical owner even when its alias still holds grants", async () => {
    await expect(check([row("external-codex", 2)])).rejects.toThrow("external-codex");
  });

  it("rejects an empty canonical owner with no revocations or pending decisions", async () => {
    await expect(check([row("external-codex"), row("AGT-EXT-CODEX", 0, 0, "specialist")]))
      .rejects.toThrow("AGT-EXT-CODEX");
  });

  it("preserves a deliberately empty canonical authority with retained revocations", async () => {
    const rows = [row("external-codex"), row("AGT-EXT-CODEX", 0, 2, "specialist")];
    const before = structuredClone(rows);
    await expect(check(rows)).resolves.toBeUndefined();
    expect(rows).toEqual(before);
  });

  it.each(["grant", "revocation"])("preserves a pending alias %s without filling either authority", async kind => {
    const rows = [row("external-codex", kind === "grant" ? 1 : 0, kind === "revocation" ? 1 : 0),
      row("AGT-EXT-CODEX", 0, 0, "specialist")];
    const before = structuredClone(rows);
    await expect(check(rows)).resolves.toBeUndefined();
    expect(rows).toEqual(before);
  });

  it("recognizes the same pending decision when the canonical row is interactive too", async () => {
    await expect(check([row("external-codex", 1), row("AGT-EXT-CODEX")])).resolves.toBeUndefined();
  });

  it("still rejects an unprovisioned custom onboarding identity", async () => {
    await expect(check([row("custom-onboarding", 0, 0, "onboarding")]))
      .rejects.toThrow("custom-onboarding");
  });

  it("keeps a custom interactive identity with saved grants", async () => {
    await expect(check([row("custom-coworker", 1)])).resolves.toBeUndefined();
  });
});
