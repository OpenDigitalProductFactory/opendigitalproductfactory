import { createVersionedOperationsSnapshot, projectCustomerOperations, summarizeCanonicalAnimalPopulation, selectOperationsScene, selectOperationsSummary, toLivingBusinessSnapshot, type CustomerOperatingFacts, type TwinSnapshot } from "../kernel/index.js";

function assert(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
const NOW = new Date("2026-10-20T12:00:00Z");
const links = { account: (id: string) => ({ label: "Inspect account", href: `/consumer/accounts/${id}` }), serviceWork: (id: string) => ({ label: "Inspect service", href: `/consumer/service/${id}` }) };
const facts: CustomerOperatingFacts = {
  accounts: [{ id: "synthetic-customer", name: "Synthetic software customer", status: "at_risk" }],
  commitments: [{ id: "synthetic-renewal", accountId: "synthetic-customer", status: "active", autoRenew: false, renewalAt: "2026-10-25T12:00:00Z" }],
  serviceWork: [{ id: "synthetic-service", accountId: "synthetic-customer", reference: "TKT-SYNTHETIC", title: "Restore customer report", status: "waiting-customer", priority: "high", dueAt: "2026-10-20T11:00:00Z", ownerRef: "synthetic-owner", owner: { name: "Synthetic owner", kind: "human" } }],
};
function snapshot(twin: TwinSnapshot, template: "TENANTS" | "ROOMS" = "TENANTS", degraded = false) {
  return createVersionedOperationsSnapshot({ identity: { archetypeId: template === "TENANTS" ? "synthetic-software" : "synthetic-shelter", archetypeName: "Synthetic operating day", template }, twin, asOf: NOW.toISOString(), sourceWatermarks: [{ source: "synthetic-canonical-facts", observedAt: "2026-10-20T11:59:59Z" }], degradedSources: degraded ? [{ source: "synthetic-canonical-facts", reason: "source-unavailable" }] : [], telemetry: { durationMs: 1, queryCount: 1, payloadBytes: 0 } });
}

export function runSmoke() {
  const groups: string[] = [];
  const twin = projectCustomerOperations(facts, NOW, links); const current = snapshot(twin);
  assert(current.freshness === "current", "Current customer source must be current");
  assert(selectOperationsScene(current).workItems[0]?.ownerRef === "synthetic-owner", "Actual work responsibility must survive projection");
  assert(current.queue.queues[0]?.items[0]?.meta?.includes("Manual renewal"), "Renewal commitment must survive");
  assert(current.scene.workItems[0]?.blockedOnExternal, "Customer dependency must be explicit");
  assert(current.scene.workItems[0]?.sublabel?.includes("Overdue"), "SLA constraint must survive");
  assert(current.scene.workItems[0]?.action?.href === "/consumer/service/synthetic-service", "Host record action reference must survive");
  assert(projectCustomerOperations(facts, NOW).workItems[0]?.action === undefined, "Absent record-link port must not invent application actions");
  groups.push("software work/responsibility/renewal/constraint/consumer-owned record reference");

  const repeat = createVersionedOperationsSnapshot({ identity: current.identity, twin, asOf: "2026-10-20T12:00:01Z", sourceWatermarks: current.sourceWatermarks, degradedSources: [], telemetry: { durationMs: 100, queryCount: 1, payloadBytes: 0 } });
  assert(current.version === repeat.version, "Read timing must not change the display revision");
  const changed = snapshot(projectCustomerOperations({ ...facts, serviceWork: [{ ...facts.serviceWork![0], status: "closed" }] }, NOW));
  assert(current.version !== changed.version, "Changed canonical work must change the read-model revision");
  groups.push("stable read revision and changed/concurrent facts");

  const stale = createVersionedOperationsSnapshot({ identity: current.identity, twin, asOf: NOW.toISOString(), sourceWatermarks: [{ source: "synthetic", observedAt: "2026-10-20T11:58:00Z" }], degradedSources: [], telemetry: current.telemetry });
  assert(stale.freshness === "stale", "Stale source must not appear current");
  assert(snapshot(projectCustomerOperations({ accounts: null, commitments: null, serviceWork: null }, NOW), "TENANTS", true).freshness === "degraded", "Unavailable source must not appear empty/current");
  groups.push("stale/degraded sources and unknown versus empty");

  const withPrivateRelation = projectCustomerOperations({ ...facts, serviceWork: [...facts.serviceWork!, { ...facts.serviceWork![0], id: "private-service", accountId: "another-account", title: "DO NOT DISCLOSE" }] }, NOW);
  assert(!JSON.stringify(withPrivateRelation).includes("DO NOT DISCLOSE"), "Unrelated account facts must not project");
  groups.push("bounded account relationship projection");

  const custody = summarizeCanonicalAnimalPopulation({ inCare: 3, legalHold: 1, placementReady: 2, intakeReview: 1 });
  assert(custody?.total === 3 && custody.onHold === 1 && custody.available === 0, "Custody must not become a public-listing availability claim");
  // The synthetic host supplies its authorized shelter representation, just as a real host does.
  const shelterTwin: TwinSnapshot = { capacityChips: [{ key: "custody", label: "Animals in care", value: custody.total }], zones: [{ key: "housing", units: [{ key: "synthetic-kennel", label: "Synthetic kennel", state: "Legal hold" }] }], workItems: [{ key: "synthetic-care", label: "Scheduled care", ownerRef: "synthetic-care-owner", sublabel: "Due today", action: { label: "Open care", href: "/consumer/shelter/care" } }], queues: [], presence: [], feed: [], quests: [], utility: [], outcomes: [{ key: "adoptions", label: "Historical adoptions", value: "2 custody outcomes" }] };
  const shelter = snapshot(shelterTwin, "ROOMS");
  assert(selectOperationsSummary(shelter).outcomes?.[0]?.value === "2 custody outcomes", "Historical outcomes must be independent of current placement state");
  assert(toLivingBusinessSnapshot(shelter).workItems[0]?.ownerRef === "synthetic-care-owner", "Shelter responsibility survives the same engine");
  groups.push("canonical custody/legal hold and synthetic shelter host through the same engine");

  assert(summarizeCanonicalAnimalPopulation(null) === null, "Unknown custody must remain unknown");
  assert(summarizeCanonicalAnimalPopulation({ inCare: 0, legalHold: 0, placementReady: 0, intakeReview: 0 })?.total === 0, "Verified zero must remain zero");
  assert(summarizeCanonicalAnimalPopulation({ inCare: NaN, legalHold: 0, placementReady: 0, intakeReview: 0 }) === null, "Invalid count must remain unavailable");
  groups.push("empty, absent and malformed custody facts");
  return { scenarioGroupsPassed: groups.length, groups, qualification: "Synthetic read-model contract only; host authorization, live business operations, command execution and served accessibility/mobile remain unqualified." };
}
