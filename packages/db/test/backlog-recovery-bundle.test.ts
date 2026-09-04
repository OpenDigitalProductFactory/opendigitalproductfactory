import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseBacklogRecoveryBundle,
  reconcileBacklogRecoveryBundle,
  type BacklogRecoveryBundle,
  type BacklogRecoveryTransaction,
  type BacklogRecoveryStore,
} from "../src/backlog-recovery-bundle";

const bundleFixture = (): BacklogRecoveryBundle => ({
  schemaVersion: 1,
  bundleId: "purpose-aware-installation-ecosystem-productivity",
  description: "Recovery fixture",
  source: {
    capturedAt: "2026-08-22T04:02:53.253Z",
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    planPath: "docs/superpowers/plans/example.md",
  },
  epic: {
    epicId: "EP-1FABA22D",
    title: "Purpose-Aware Installation and Ecosystem Productivity",
    description: "Coordinate installation through first value.",
    status: "in-progress",
    priority: 1,
    scopeKind: "platform",
    scopeRationale: "Cross-cutting platform journey.",
  },
  items: [
    {
      itemId: "BI-A9F60372",
      epicId: "EP-1FABA22D",
      title: "Establish the typed operating-intent contract",
      body: "Delivered by PR #4334.",
      status: "done",
      type: "product",
      workType: "feature",
      source: "user-request",
      effortSize: "medium",
      triageOutcome: "build",
      scopeKind: "platform",
      scopeRationale: "Cross-cutting platform journey.",
      dependsOn: [],
      externalDependencies: [],
      completedAt: "2026-08-22T04:02:53.249Z",
      resolution: "Delivered by merged PR #4334.",
      activities: [
        {
          recoveryKey: "p0-pr-4334",
          kind: "evidence",
          summary: "Typed operating-intent foundation merged in PR #4334",
          recordedAt: "2026-08-22T04:02:44.635Z",
          payload: {
            evidenceKind: "external_link",
            url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4334",
          },
        },
        {
          recoveryKey: "p0-completed",
          kind: "status_change",
          summary: "open → done",
          recordedAt: "2026-08-22T04:02:53.253Z",
          payload: { from: "open", to: "done", resolution: "Delivered by merged PR #4334." },
        },
      ],
    },
    {
      itemId: "BI-91EF130B",
      epicId: "EP-1FABA22D",
      title: "Build the deterministic journey compiler",
      body: "Compile profile-specific journeys.",
      status: "open",
      type: "product",
      workType: "feature",
      source: "user-request",
      effortSize: "large",
      triageOutcome: "build",
      scopeKind: "platform",
      scopeRationale: "Cross-cutting platform journey.",
      dependsOn: ["BI-A9F60372"],
      externalDependencies: [],
      activities: [],
    },
  ],
});

type StoredEpic = BacklogRecoveryBundle["epic"] & { internalId: string };
type StoredItem = BacklogRecoveryBundle["items"][number] & { internalId: string; epicInternalId: string };
type StoredActivity = BacklogRecoveryBundle["items"][number]["activities"][number] & {
  itemInternalId: string;
};

class MemoryStore implements BacklogRecoveryStore {
  epics = new Map<string, StoredEpic>();
  items = new Map<string, StoredItem>();
  activities = new Map<string, StoredActivity>();
  failOnItemId: string | null = null;

  async transaction<T>(work: (tx: BacklogRecoveryTransaction) => Promise<T>): Promise<T> {
    const snapshot = {
      epics: new Map(this.epics),
      items: new Map(this.items),
      activities: new Map(this.activities),
    };
    try {
      return await work(this);
    } catch (error) {
      this.epics = snapshot.epics;
      this.items = snapshot.items;
      this.activities = snapshot.activities;
      throw error;
    }
  }

  async findEpic(epicId: string) {
    return this.epics.get(epicId) ?? null;
  }

  async findItem(itemId: string) {
    return this.items.get(itemId) ?? null;
  }

  async createEpic(epic: BacklogRecoveryBundle["epic"]) {
    const stored = { ...epic, internalId: `epic-${this.epics.size + 1}` };
    this.epics.set(epic.epicId, stored);
    return { internalId: stored.internalId };
  }

  async createItem(item: BacklogRecoveryBundle["items"][number], epicInternalId: string) {
    if (item.itemId === this.failOnItemId) throw new Error("injected item failure");
    const stored = { ...item, epicInternalId, internalId: `item-${this.items.size + 1}` };
    this.items.set(item.itemId, stored);
    return { internalId: stored.internalId };
  }

  async createActivity(
    activity: BacklogRecoveryBundle["items"][number]["activities"][number],
    itemInternalId: string,
    _context: { bundleId: string },
  ) {
    this.activities.set(activity.recoveryKey, { ...activity, itemInternalId });
  }
}

describe("backlog recovery bundle", () => {
  // Asserts the CONTRACT every committed bundle must satisfy, not one snapshot's
  // contents. Bundles are re-captured before each teardown, so pinning an exact
  // item list here would fail on every correct refresh — which would pressure
  // people to skip refreshing, the exact loss this format exists to prevent.
  // Done-item provenance and evidence rules are covered by bundleFixture() below.
  it("commits a parseable, not-done, idempotently restorable bundle for the approved epic", async () => {
    const path = fileURLToPath(
      new URL(
        "../recovery/backlog/purpose-aware-installation-ecosystem-productivity.json",
        import.meta.url,
      ),
    );
    const bundle = parseBacklogRecoveryBundle(JSON.parse(readFileSync(path, "utf8")));

    expect(bundle.epic.epicId).toBe("EP-1FABA22D");
    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items.every((item) => item.epicId === bundle.epic.epicId)).toBe(true);
    expect(new Set(bundle.items.map((item) => item.itemId)).size).toBe(bundle.items.length);

    // Capture exports unfinished work only. Completed work is recorded in git as
    // merged PRs; re-importing it would resurrect closed records.
    expect(bundle.items.filter((item) => item.status === "done")).toEqual([]);

    const store = new MemoryStore();
    const first = await reconcileBacklogRecoveryBundle(store, bundle, { apply: true });
    expect(first.epic.create).toEqual(["EP-1FABA22D"]);
    expect(first.items.create).toHaveLength(bundle.items.length);
    expect(store.epics.size).toBe(1);
    expect(store.items.size).toBe(bundle.items.length);

    const second = await reconcileBacklogRecoveryBundle(store, bundle, { apply: true });
    expect(second.epic.create).toEqual([]);
    expect(second.items.create).toEqual([]);
    expect(second.activities.create).toEqual([]);
  });

  it("strictly validates a versioned semantic bundle", () => {
    expect(parseBacklogRecoveryBundle(bundleFixture())).toEqual(bundleFixture());
    expect(() => parseBacklogRecoveryBundle({ ...bundleFixture(), schemaVersion: 2 })).toThrow(
      "schemaVersion",
    );
    expect(() =>
      parseBacklogRecoveryBundle({ ...bundleFixture(), internalId: "must-not-cross-installs" }),
    ).toThrow("unknown key");
  });

  it("rejects invalid dependencies, unsafe payload keys, and incomplete done items", () => {
    const missingDependency = bundleFixture();
    missingDependency.items[1]!.dependsOn = ["BI-DOESNOTEXIST"];
    expect(() => parseBacklogRecoveryBundle(missingDependency)).toThrow("dependsOn");

    const unsafePayload = bundleFixture();
    unsafePayload.items[0]!.activities[0]!.payload = { apiToken: "secret" };
    expect(() => parseBacklogRecoveryBundle(unsafePayload)).toThrow("apiToken");

    const incompleteDone = bundleFixture();
    delete incompleteDone.items[0]!.completedAt;
    expect(() => parseBacklogRecoveryBundle(incompleteDone)).toThrow("completedAt");

    const missingResolution = bundleFixture();
    delete missingResolution.items[0]!.resolution;
    expect(() => parseBacklogRecoveryBundle(missingResolution)).toThrow("resolution");

    const mislabeledDependency = bundleFixture();
    mislabeledDependency.items[1]!.externalDependencies = ["BI-A9F60372"];
    expect(() => parseBacklogRecoveryBundle(mislabeledDependency)).toThrow("must be listed in dependsOn");
  });

  it("previews without writing, then creates the graph in one apply", async () => {
    const store = new MemoryStore();
    const bundle = parseBacklogRecoveryBundle(bundleFixture());

    const preview = await reconcileBacklogRecoveryBundle(store, bundle, { apply: false });
    expect(preview).toMatchObject({
      mode: "dry-run",
      epic: { create: ["EP-1FABA22D"], skip: [] },
      items: { create: ["BI-A9F60372", "BI-91EF130B"], skip: [] },
      activities: { create: ["p0-pr-4334", "p0-completed"], skip: [] },
    });
    expect(store.epics.size).toBe(0);

    const applied = await reconcileBacklogRecoveryBundle(store, bundle, { apply: true });
    expect(applied.mode).toBe("apply");
    expect(store.epics.size).toBe(1);
    expect(store.items.size).toBe(2);
    expect(store.activities.size).toBe(2);
  });

  it("is idempotent and never regresses an existing item", async () => {
    const store = new MemoryStore();
    const bundle = parseBacklogRecoveryBundle(bundleFixture());
    await reconcileBacklogRecoveryBundle(store, bundle, { apply: true });

    const existing = store.items.get("BI-91EF130B")!;
    existing.status = "in-progress";
    existing.body = "Operator progress must win over recovery input.";

    const second = await reconcileBacklogRecoveryBundle(store, bundle, { apply: true });
    expect(second.items).toEqual({ create: [], skip: ["BI-A9F60372", "BI-91EF130B"] });
    expect(second.activities).toEqual({ create: [], skip: ["p0-pr-4334", "p0-completed"] });
    expect(store.items.get("BI-91EF130B")).toMatchObject({
      status: "in-progress",
      body: "Operator progress must win over recovery input.",
    });
  });

  it("rolls the whole graph back when any create fails", async () => {
    const store = new MemoryStore();
    store.failOnItemId = "BI-91EF130B";

    await expect(
      reconcileBacklogRecoveryBundle(store, parseBacklogRecoveryBundle(bundleFixture()), { apply: true }),
    ).rejects.toThrow("injected item failure");
    expect(store.epics.size).toBe(0);
    expect(store.items.size).toBe(0);
    expect(store.activities.size).toBe(0);
  });
});
