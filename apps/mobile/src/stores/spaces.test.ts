import type {
  AppConfigManifest,
  InstanceDescriptor,
  Space,
  SpacesRegistry,
} from "@dpf/types";
import {
  addSpaceToRegistry,
  findSpace,
  getActiveSpace,
  removeSpaceFromRegistry,
  setActiveSpaceInRegistry,
  useSpacesStore,
  type SpacesStorage,
} from "./spaces";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function descriptor(
  instanceId: string,
  orgName = `Org ${instanceId}`,
): InstanceDescriptor {
  return {
    instanceId,
    orgName,
    apiVersion: "v1",
    authModes: ["password"],
  };
}

function space(id: string, lastUsedAt?: number): Space {
  return {
    spaceId: id,
    url: `https://${id}.dpf.example`,
    label: `Org ${id}`,
    descriptor: descriptor(id),
    lastUsedAt,
  };
}

const empty: SpacesRegistry = { spaces: [], activeSpaceId: null };

const manifest: AppConfigManifest = {
  schemaVersion: "1",
  org: { name: "Org a" },
  persona: { kind: "customer" },
  capabilities: ["work-items"],
};

/** Capturing in-memory storage mock (mirrors the offline queue's QueueStorage). */
function makeStorage(initial: SpacesRegistry | null = null) {
  let saved: SpacesRegistry | null = initial;
  const storage: SpacesStorage & { last: () => SpacesRegistry | null } = {
    load: jest.fn(() => saved),
    save: jest.fn((r: SpacesRegistry) => {
      saved = r;
    }),
    last: () => saved,
  };
  return storage;
}

/* ================================================================== */
/*  Pure reducers                                                      */
/* ================================================================== */

describe("addSpaceToRegistry", () => {
  it("adds the first space and makes it active", () => {
    const next = addSpaceToRegistry(empty, space("a"));
    expect(next.spaces).toHaveLength(1);
    expect(next.activeSpaceId).toBe("a");
  });

  it("adds a second space WITHOUT changing the active selection", () => {
    const one = addSpaceToRegistry(empty, space("a"));
    const two = addSpaceToRegistry(one, space("b"));
    expect(two.spaces.map((s) => s.spaceId)).toEqual(["a", "b"]);
    expect(two.activeSpaceId).toBe("a");
  });

  it("re-adding the same id updates fields in place (no duplicate)", () => {
    const one = addSpaceToRegistry(empty, space("a"));
    const updated: Space = { ...space("a"), label: "Renamed" };
    const two = addSpaceToRegistry(one, updated);
    expect(two.spaces).toHaveLength(1);
    expect(two.spaces[0].label).toBe("Renamed");
    expect(two.activeSpaceId).toBe("a");
  });
});

describe("removeSpaceFromRegistry", () => {
  it("removes a space and clears active when none remain", () => {
    const one = addSpaceToRegistry(empty, space("a"));
    const gone = removeSpaceFromRegistry(one, "a");
    expect(gone.spaces).toHaveLength(0);
    expect(gone.activeSpaceId).toBeNull();
  });

  it("falls active back to the most-recently-used remaining space", () => {
    const reg: SpacesRegistry = {
      spaces: [space("a", 100), space("b", 300), space("c", 200)],
      activeSpaceId: "a",
    };
    const next = removeSpaceFromRegistry(reg, "a");
    expect(next.activeSpaceId).toBe("b"); // highest lastUsedAt
  });

  it("leaves active untouched when a non-active space is removed", () => {
    const reg: SpacesRegistry = {
      spaces: [space("a"), space("b")],
      activeSpaceId: "a",
    };
    const next = removeSpaceFromRegistry(reg, "b");
    expect(next.activeSpaceId).toBe("a");
  });
});

describe("setActiveSpaceInRegistry", () => {
  it("sets the active space when the id is known", () => {
    const reg = addSpaceToRegistry(addSpaceToRegistry(empty, space("a")), space("b"));
    expect(setActiveSpaceInRegistry(reg, "b").activeSpaceId).toBe("b");
  });

  it("is a no-op for an unknown id", () => {
    const reg = addSpaceToRegistry(empty, space("a"));
    expect(setActiveSpaceInRegistry(reg, "zzz")).toBe(reg);
  });
});

describe("getActiveSpace / findSpace", () => {
  it("returns the active space, or null when the active id is stale", () => {
    const reg = addSpaceToRegistry(empty, space("a"));
    expect(getActiveSpace(reg)?.spaceId).toBe("a");
    expect(getActiveSpace({ ...reg, activeSpaceId: "ghost" })).toBeNull();
    expect(getActiveSpace(empty)).toBeNull();
  });

  it("finds a space by id", () => {
    const reg = addSpaceToRegistry(empty, space("a"));
    expect(findSpace(reg, "a")?.url).toBe("https://a.dpf.example");
    expect(findSpace(reg, "b")).toBeUndefined();
  });
});

/* ================================================================== */
/*  Store                                                              */
/* ================================================================== */

describe("useSpacesStore", () => {
  beforeEach(() => {
    useSpacesStore.setState({ spaces: [], activeSpaceId: null, storage: null });
  });

  it("addSpace builds a Space from the descriptor and enters it", () => {
    const added = useSpacesStore
      .getState()
      .addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a", "Acme HVAC") });

    expect(added.spaceId).toBe("a");
    expect(added.label).toBe("Acme HVAC"); // defaults to org name
    expect(added.lastUsedAt).toEqual(expect.any(Number));
    expect(useSpacesStore.getState().activeSpaceId).toBe("a");
  });

  it("addSpace honours an explicit label override", () => {
    const added = useSpacesStore.getState().addSpace({
      url: "https://a.dpf.example",
      descriptor: descriptor("a", "Acme HVAC"),
      label: "My Salon",
    });
    expect(added.label).toBe("My Salon");
  });

  it("entering a newly added space makes it active (last-added wins)", () => {
    const s = useSpacesStore.getState();
    s.addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    s.addSpace({ url: "https://b.dpf.example", descriptor: descriptor("b") });
    expect(useSpacesStore.getState().activeSpaceId).toBe("b");
    expect(useSpacesStore.getState().spaces).toHaveLength(2);
  });

  it("switchSpace returns false for an unknown id and true for a known one", () => {
    const s = useSpacesStore.getState();
    s.addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    s.addSpace({ url: "https://b.dpf.example", descriptor: descriptor("b") });
    expect(useSpacesStore.getState().switchSpace("ghost")).toBe(false);
    expect(useSpacesStore.getState().switchSpace("a")).toBe(true);
    expect(useSpacesStore.getState().activeSpaceId).toBe("a");
  });

  it("removeSpace falls the active selection back to a remaining space", () => {
    const s = useSpacesStore.getState();
    s.addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    s.addSpace({ url: "https://b.dpf.example", descriptor: descriptor("b") });
    // active is "b" (last added); removing it should fall back to "a"
    useSpacesStore.getState().removeSpace("b");
    expect(useSpacesStore.getState().activeSpaceId).toBe("a");
    expect(useSpacesStore.getState().spaces).toHaveLength(1);
  });

  it("setSpaceManifest / setSpaceSession attach per-space without bleeding to others", () => {
    const s = useSpacesStore.getState();
    s.addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    s.addSpace({ url: "https://b.dpf.example", descriptor: descriptor("b") });

    useSpacesStore.getState().setSpaceManifest("a", manifest);
    useSpacesStore.getState().setSpaceSession("a", { authenticated: true, personaKind: "customer" });

    const a = findSpace(
      { spaces: useSpacesStore.getState().spaces, activeSpaceId: null },
      "a",
    );
    const b = findSpace(
      { spaces: useSpacesStore.getState().spaces, activeSpaceId: null },
      "b",
    );
    expect(a?.manifest?.capabilities).toEqual(["work-items"]);
    expect(a?.session?.authenticated).toBe(true);
    // No bleed: space b is untouched.
    expect(b?.manifest).toBeUndefined();
    expect(b?.session).toBeUndefined();
  });

  it("getActiveSpace reflects the live active selection", () => {
    const s = useSpacesStore.getState();
    s.addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    expect(useSpacesStore.getState().getActiveSpace()?.spaceId).toBe("a");
  });
});

/* ================================================================== */
/*  Persistence                                                        */
/* ================================================================== */

describe("registry persistence", () => {
  beforeEach(() => {
    useSpacesStore.setState({ spaces: [], activeSpaceId: null, storage: null });
  });

  it("persists the registry on add, stripping runtime session/manifest", () => {
    const storage = makeStorage();
    useSpacesStore.getState().configureStorage(storage);

    useSpacesStore.getState().addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") });
    useSpacesStore.getState().setSpaceManifest("a", manifest);
    useSpacesStore.getState().setSpaceSession("a", { authenticated: true });
    // setSpaceManifest/Session are runtime-only; force a persist:
    useSpacesStore.getState().switchSpace("a");

    const saved = storage.last();
    expect(saved?.spaces).toHaveLength(1);
    expect(saved?.spaces[0].spaceId).toBe("a");
    expect(saved?.spaces[0].descriptor.instanceId).toBe("a");
    // Durable identity only — no runtime fields leak into the persisted form.
    expect(saved?.spaces[0]).not.toHaveProperty("manifest");
    expect(saved?.spaces[0]).not.toHaveProperty("session");
  });

  it("hydrate loads a previously persisted registry", () => {
    const persisted: SpacesRegistry = {
      spaces: [space("a"), space("b")],
      activeSpaceId: "b",
    };
    const storage = makeStorage(persisted);
    useSpacesStore.getState().configureStorage(storage);
    useSpacesStore.getState().hydrate();

    expect(useSpacesStore.getState().spaces.map((s) => s.spaceId)).toEqual(["a", "b"]);
    expect(useSpacesStore.getState().activeSpaceId).toBe("b");
  });

  it("works in-memory with no storage configured (persist is a no-op)", () => {
    expect(() =>
      useSpacesStore.getState().addSpace({ url: "https://a.dpf.example", descriptor: descriptor("a") }),
    ).not.toThrow();
    expect(useSpacesStore.getState().spaces).toHaveLength(1);
  });
});
