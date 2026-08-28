import { describe, expect, it, vi } from "vitest";

import { branchDn, deriveBaseDn, escapeRdnValue, isWithinSubtree, principalDn } from "./dn";
import { buildDirectoryProjection, fingerprintEntries, type ProjectionDb } from "./projection";
import { PUBLISHED_ATTRIBUTES, WITHHELD_ATTRIBUTES, applyPublicationAllowlist } from "./schema";

function makeDb(overrides?: {
  organization?: { slug: string; website?: string | null } | null;
  principals?: Array<{
    principalId: string;
    kind: string;
    displayName: string;
    aliases: Array<{ aliasType: string; aliasValue: string }>;
  }>;
  roles?: Array<{
    roleId: string;
    name: string;
    description: string | null;
    users: Array<{ userId: string }>;
  }>;
  teams?: Array<{
    slug: string;
    name: string;
    description: string | null;
    memberships: Array<{ userId: string }>;
  }>;
}) {
  const db = {
    organization: {
      findFirst: vi.fn(async () =>
        overrides?.organization === undefined
          ? { slug: "acme", website: "https://www.acme.com" }
          : overrides.organization,
      ),
    },
    principal: { findMany: vi.fn(async () => overrides?.principals ?? []) },
    platformRole: { findMany: vi.fn(async () => overrides?.roles ?? []) },
    team: { findMany: vi.fn(async () => overrides?.teams ?? []) },
  };
  return { db, injected: db as unknown as ProjectionDb };
}

const HUMAN = {
  principalId: "prn-human-1",
  kind: "human",
  displayName: "Dana Reed",
  aliases: [
    { aliasType: "user", aliasValue: "user-1" },
    { aliasType: "employee", aliasValue: "EMP-100" },
    { aliasType: "mail", aliasValue: "dana@acme.com" },
  ],
};
const AGENT = {
  principalId: "prn-agent-1",
  kind: "agent",
  displayName: "HR Specialist",
  aliases: [{ aliasType: "gaid", aliasValue: "gaid:priv:dpf.internal:hr-specialist" }],
};
const SERVICE = {
  principalId: "browser-svc:substack:default",
  kind: "service",
  displayName: "substack service account (default)",
  aliases: [{ aliasType: "service-account", aliasValue: "browser-svc:substack:default" }],
};

describe("deriveBaseDn — the namespace is the organization's, not a constant", () => {
  it("derives from the organization website, dropping www", () => {
    expect(deriveBaseDn({ slug: "acme", website: "https://www.acme.com" })).toBe("dc=acme,dc=com");
  });

  it("accepts a bare host with no scheme", () => {
    expect(deriveBaseDn({ slug: "acme", website: "acme.co.uk" })).toBe("dc=acme,dc=co,dc=uk");
  });

  it("falls back to the slug under a reserved domain that cannot collide with a real one", () => {
    expect(deriveBaseDn({ slug: "acme", website: null })).toBe("dc=acme,dc=internal");
    expect(deriveBaseDn({ slug: "acme", website: "not a url" })).toBe("dc=acme,dc=internal");
  });

  it("refuses to derive a DN for an organization with no slug", () => {
    expect(() => deriveBaseDn({ slug: "  ", website: null })).toThrow(/slug/i);
  });
});

describe("escapeRdnValue — RFC 4514", () => {
  it("escapes the reserved set wherever it appears", () => {
    expect(escapeRdnValue("Reed, Dana")).toBe("Reed\\, Dana");
    expect(escapeRdnValue('a+b"c<d>e;f=g')).toBe('a\\+b\\"c\\<d\\>e\\;f\\=g');
    expect(escapeRdnValue("back\\slash")).toBe("back\\\\slash");
  });

  it("escapes a leading hash or space and a trailing space", () => {
    expect(escapeRdnValue("#lead")).toBe("\\#lead");
    expect(escapeRdnValue(" lead")).toBe("\\ lead");
    expect(escapeRdnValue("trail ")).toBe("trail\\ ");
  });

  it("refuses a NUL byte rather than encoding it", () => {
    expect(() => escapeRdnValue("a\0b")).toThrow(/NUL/i);
  });

  it("prevents an injected comma from re-parenting an entry", () => {
    const dn = principalDn("dc=acme,dc=com", "people", "evil,ou=groups");
    expect(dn).toBe("uid=evil\\,ou\\=groups,ou=people,dc=acme,dc=com");
  });
});

describe("isWithinSubtree — scope containment", () => {
  it("matches the base itself and anything beneath it", () => {
    expect(isWithinSubtree("dc=acme,dc=com", "dc=acme,dc=com")).toBe(true);
    expect(isWithinSubtree("ou=people,dc=acme,dc=com", "dc=acme,dc=com")).toBe(true);
  });
  it("does not match a sibling namespace that merely ends similarly", () => {
    expect(isWithinSubtree("dc=notacme,dc=com", "dc=acme,dc=com")).toBe(false);
  });
});

describe("buildDirectoryProjection — three classes, one path", () => {
  it("projects a human, an agent and a service account into their branches", async () => {
    const { injected } = makeDb({ principals: [HUMAN, AGENT, SERVICE] });
    const projection = await buildDirectoryProjection(injected);

    expect(projection.baseDn).toBe("dc=acme,dc=com");
    const byDn = new Map(projection.entries.map((e) => [e.dn, e]));

    const human = byDn.get("uid=prn-human-1,ou=people,dc=acme,dc=com");
    expect(human?.attributes.objectClass).toContain("inetOrgPerson");
    expect(human?.attributes.mail).toEqual(["dana@acme.com"]);
    expect(human?.attributes.employeeNumber).toEqual(["EMP-100"]);

    const agent = byDn.get("uid=prn-agent-1,ou=agents,dc=acme,dc=com");
    expect(agent?.attributes.objectClass).toContain("dpfAgent");
    expect(agent?.attributes.dpfGaid).toEqual(["gaid:priv:dpf.internal:hr-specialist"]);

    const service = byDn.get("uid=browser-svc:substack:default,ou=services,dc=acme,dc=com");
    expect(service?.attributes.objectClass).toContain("dpfServiceAccount");
  });

  it("publishes the branch containers so a subtree search returns a tree", async () => {
    const { injected } = makeDb();
    const projection = await buildDirectoryProjection(injected);
    for (const branch of ["people", "agents", "services", "groups"] as const) {
      const entry = projection.entries.find((e) => e.dn === branchDn(projection.baseDn, branch));
      expect(entry?.attributes.objectClass).toContain("organizationalUnit");
    }
  });

  it("queries only active principals of published kinds — inactive ones are ABSENT, not flagged", async () => {
    const { db, injected } = makeDb();
    await buildDirectoryProjection(injected);
    expect(db.principal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "active", kind: { in: ["human", "agent", "service"] } },
      }),
    );
  });

  it("projects groups from roles and teams, naming real member DNs", async () => {
    const { injected } = makeDb({
      principals: [HUMAN],
      roles: [{ roleId: "ceo", name: "CEO", description: null, users: [{ userId: "user-1" }] }],
      teams: [
        { slug: "platform", name: "Platform", description: "Platform team", memberships: [{ userId: "user-1" }] },
      ],
    });
    const projection = await buildDirectoryProjection(injected);
    const byDn = new Map(projection.entries.map((e) => [e.dn, e]));

    const role = byDn.get("cn=role-ceo,ou=groups,dc=acme,dc=com");
    expect(role?.attributes.objectClass).toContain("groupOfNames");
    expect(role?.attributes.member).toEqual(["uid=prn-human-1,ou=people,dc=acme,dc=com"]);

    const team = byDn.get("cn=team-platform,ou=groups,dc=acme,dc=com");
    expect(team?.attributes.member).toEqual(["uid=prn-human-1,ou=people,dc=acme,dc=com"]);
  });

  it("omits a member whose user has no published principal rather than emitting a dangling DN", async () => {
    const { injected } = makeDb({
      principals: [],
      roles: [{ roleId: "ceo", name: "CEO", description: null, users: [{ userId: "ghost" }] }],
    });
    const projection = await buildDirectoryProjection(injected);
    const role = projection.entries.find((e) => e.dn.startsWith("cn=role-ceo,"));
    expect(role?.attributes.member).toBeUndefined();
  });

  it("refuses to publish when no Organization exists — the tree is the org's namespace", async () => {
    const { injected } = makeDb({ organization: null });
    await expect(buildDirectoryProjection(injected)).rejects.toThrow(/Organization/i);
  });
});

describe("the publication allowlist is a security control", () => {
  it.each(WITHHELD_ATTRIBUTES)("never publishes $field — $reason", async ({ field }) => {
    const { injected } = makeDb({ principals: [HUMAN, AGENT, SERVICE] });
    const projection = await buildDirectoryProjection(injected);
    for (const entry of projection.entries) {
      expect(Object.keys(entry.attributes)).not.toContain(field);
    }
  });

  it("drops an attribute the projection loaded but the allowlist does not name", () => {
    const filtered = applyPublicationAllowlist(
      { cn: ["x"], passwordHash: ["secret"], sponsorPrincipalId: ["prn-owner"] },
      PUBLISHED_ATTRIBUTES.people,
    );
    expect(filtered).toEqual({ cn: ["x"] });
  });

  it("withholds the sponsor even though a service account always has one", async () => {
    const { injected } = makeDb({ principals: [SERVICE] });
    const projection = await buildDirectoryProjection(injected);
    const service = projection.entries.find((e) => e.branch === "services");
    expect(JSON.stringify(service)).not.toContain("sponsor");
  });
});

describe("the projection is derived and read-only", () => {
  it("never reaches a write method — there is no path back through the projection", async () => {
    const { db, injected } = makeDb({ principals: [HUMAN] });
    const forbid = (name: string) => () => {
      throw new Error(`projection attempted a write: ${name}`);
    };
    for (const [model, delegate] of Object.entries(db)) {
      for (const write of ["create", "update", "upsert", "delete", "deleteMany", "updateMany", "createMany"]) {
        (delegate as Record<string, unknown>)[write] = forbid(`${model}.${write}`);
      }
    }
    await expect(buildDirectoryProjection(injected)).resolves.toBeDefined();
  });
});

describe("fingerprint", () => {
  it("is stable across attribute and entry ordering", () => {
    const a = fingerprintEntries("dc=acme,dc=com", [
      { dn: "uid=b,ou=people,dc=acme,dc=com", branch: "people", attributes: { cn: ["b"], uid: ["b"] } },
      { dn: "uid=a,ou=people,dc=acme,dc=com", branch: "people", attributes: { uid: ["a"], cn: ["a"] } },
    ]);
    const b = fingerprintEntries("dc=acme,dc=com", [
      { dn: "uid=a,ou=people,dc=acme,dc=com", branch: "people", attributes: { cn: ["a"], uid: ["a"] } },
      { dn: "uid=b,ou=people,dc=acme,dc=com", branch: "people", attributes: { uid: ["b"], cn: ["b"] } },
    ]);
    expect(a).toBe(b);
  });

  it("changes when a published value changes", () => {
    const base = fingerprintEntries("dc=acme,dc=com", [
      { dn: "uid=a,ou=people,dc=acme,dc=com", branch: "people", attributes: { cn: ["a"] } },
    ]);
    const moved = fingerprintEntries("dc=acme,dc=com", [
      { dn: "uid=a,ou=people,dc=acme,dc=com", branch: "people", attributes: { cn: ["changed"] } },
    ]);
    expect(base).not.toBe(moved);
  });
});
