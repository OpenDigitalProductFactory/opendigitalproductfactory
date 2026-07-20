import { describe, expect, it } from "vitest";

import { buildFederatedDemandArchitectureModel } from "./federated-demand-architecture-extract";

describe("federated demand SysML projection", () => {
  const model = buildFederatedDemandArchitectureModel();
  const byKey = new Map(model.elements.map((element) => [element.sysmlKey, element]));

  it("preserves the authority break from local backlog through forge delivery", () => {
    expect(byKey.get("fdn:part:local-backlog")?.properties).toMatchObject({ prismaModel: "BacklogItem" });
    expect(byKey.get("fdn:part:federated-mirror")?.properties).toMatchObject({ prismaModel: "FederatedRecordMirror" });
    expect(byKey.get("fdn:part:pairing-session")?.properties).toMatchObject({ prismaModel: "FederationPairingSession" });
    expect(byKey.get("fdn:part:founder-cluster")?.properties).toMatchObject({ prismaModel: "FounderDemandCluster" });
    expect(byKey.get("fdn:part:hive-ledger")?.properties).toMatchObject({ prismaModel: "HiveContributionLedger" });
    expect(byKey.get("fdn:part:forge")?.description).toContain("not backlog or federation authority");
  });

  it("models all requirements, ports, and verification cases from the design", () => {
    expect(model.elements.filter((element) => element.sysmlKey.startsWith("fdn:req:"))).toHaveLength(11);
    expect(model.elements.filter((element) => element.sysmlKey.startsWith("fdn:port:"))).toHaveLength(8);
    expect(model.elements.filter((element) => element.sysmlKey.startsWith("fdn:vc:"))).toHaveLength(15);
    expect(model.relationships).toContainEqual({ fromKey: "fdn:vc:15", toKey: "fdn:req:11", relSlug: "verifies" });
    expect(model.relationships).toContainEqual({ fromKey: "fdn:part:pairing-session", toKey: "fdn:port:pairing", relSlug: "connects" });
    expect(model.relationships).toContainEqual({ fromKey: "fdn:part:pairing-session", toKey: "fdn:req:02", relSlug: "satisfies" });
  });
});
