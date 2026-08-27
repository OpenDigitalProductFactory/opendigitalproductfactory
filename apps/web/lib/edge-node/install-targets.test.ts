// BI-6052C2C2 — the edge install targets, pinned.
//
// Founder constraint, 2026-08-27: "The edge is part of this instance, and also
// used when we have certain archetypes. Preserve that and also all the install
// targets we have planned too."
//
// The change that threatens this is not malice, it is simplification. "Provision
// an edge node by default" reads like one switch, and the shortest path to it
// deletes overlays that look redundant, folds three install modes into two, or
// makes the installation's own node a special case of the remote flow. Each of
// those is a quiet regression: the air-gapped and macvlan paths have no CI
// coverage and would not fail loudly.
//
// So the constraint stops being a paragraph in a backlog item and becomes a
// test. Deleting a planned target is then a decision someone makes on purpose,
// with this file in the diff, rather than a side effect of tidying.
//
// This asserts the SHAPES exist and stay distinct. It does not assert they work
// — end-to-end proof needs two boxes on a LAN, which is tracked separately.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EDGE_NODE_INSTALL_MODES,
  EDGE_NODE_PLATFORMS,
} from "@dpf/db/edge-node-types";

import { NATIVE_ASSET_BY_TARGET } from "./remote-provisioning";

const repoPath = (relative: string) =>
  fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

/**
 * Every planned deployment shape, and what each one is FOR.
 *
 * The reason column is the point: a reviewer deleting one should have to
 * disagree with a stated purpose rather than judge a filename redundant.
 */
const COMPOSE_TARGETS: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "docker-compose.edge.yml",
    why: "co-located — the edge node that is part of THIS installation, mapping the LAN around the box that runs the portal",
  },
  {
    file: "docker-compose.edge-standalone.yml",
    why: "remote — a node on separate hardware, the branch office / customer site case",
  },
  {
    file: "docker-compose.edge-standalone-tls.yml",
    why: "remote over TLS with an operator-trusted CA",
  },
  {
    file: "docker-compose.edge-snmp.yml",
    why: "SNMP collector overlay",
  },
  {
    file: "docker-compose.edge.macvlan.yml",
    why: "macvlan networking, where the node needs its own L2 presence",
  },
  {
    file: "docker-compose.edge-actions.yml",
    why: "signed mTLS edge action channel",
  },
];

describe("planned edge install targets survive", () => {
  it.each(COMPOSE_TARGETS)("$file exists — $why", ({ file }) => {
    expect(existsSync(repoPath(file))).toBe(true);
  });

  it("keeps co-located and standalone as SEPARATE overlays", () => {
    // Folding these together is the most tempting simplification and the most
    // damaging: the installation's own node and a node on someone else's
    // hardware have different networking, trust and lifecycle.
    const colocated = readFileSync(repoPath("docker-compose.edge.yml"), "utf8");
    const standalone = readFileSync(repoPath("docker-compose.edge-standalone.yml"), "utf8");
    expect(colocated).not.toEqual(standalone);
  });
});

describe("the install-mode vocabulary stays open enough to tell the truth", () => {
  // Asserts PRESENCE, not an exact set. The constraint is "preserve the planned
  // targets" — freezing the array would also block a legitimate NEW mode, which
  // turns this guard into an obstacle and gets it deleted for the wrong reason.
  it("keeps all three modes", () => {
    for (const mode of ["native", "container-host", "container-vm"]) {
      expect(EDGE_NODE_INSTALL_MODES, `install mode ${mode} was dropped`).toContain(mode);
    }
  });

  // container-vm is the Docker Desktop case: the node enrols, reports trusted,
  // and cannot see the host's real LAN. Collapsing it into container-host is how
  // a node reads healthy while observing nothing, which is the worst failure
  // shape this subsystem has.
  it("keeps container-vm distinct from container-host", () => {
    expect(EDGE_NODE_INSTALL_MODES).toContain("container-vm");
    expect(EDGE_NODE_INSTALL_MODES).toContain("container-host");
  });

  it("keeps every host platform", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      expect(EDGE_NODE_PLATFORMS, `host platform ${platform} was dropped`).toContain(platform);
    }
  });
});

describe("the native build matrix stays complete", () => {
  // #4683 made the release publish all six and fail when one is missing. This
  // pins the other half: the portal must still know how to OFFER all six.
  it("covers every OS and architecture", () => {
    const targets = Object.keys(NATIVE_ASSET_BY_TARGET);
    for (const target of [
      "darwin-amd64",
      "darwin-arm64",
      "linux-amd64",
      "linux-arm64",
      "windows-amd64",
      "windows-arm64",
    ]) {
      expect(targets, `native build target ${target} was dropped`).toContain(target);
    }
  });

  it("keeps the Makefile able to build each one", () => {
    const makefile = readFileSync(repoPath("services/edge-node-go/Makefile"), "utf8");
    for (const target of Object.keys(NATIVE_ASSET_BY_TARGET)) {
      expect(makefile, `Makefile lost build-${target}`).toContain(`build-${target}`);
    }
  });
});

describe("the installation's own node keeps its own readiness bar", () => {
  const page = readFileSync(
    repoPath("apps/web/app/(shell)/platform/edge-nodes/page.tsx"),
    "utf8",
  );

  // Founder constraint 1: the edge is part of this instance. The main
  // installation's node is held to federation.discovery; a remote node is not.
  // If this distinction disappears, "part of this instance" has been reduced to
  // a special case of the remote flow.
  it("still distinguishes the main installation from a remote node", () => {
    expect(page).toContain("isMainInstallation");
  });

  it("still requires federation.discovery of the installation's own node", () => {
    expect(page).toContain("federation.discovery");
  });
});

describe("air-gapped and macvlan stay documented, since CI cannot exercise them", () => {
  it.each([
    ["docs/install/edge-node-air-gapped.md", "air-gapped install"],
    ["docs/edge-node/macvlan-deployment.md", "macvlan deployment"],
    ["docs/edge-node/fleet-operations.md", "many nodes against one Authority Core"],
    ["docs/edge-node/deployment-topology.md", "co-located vs remote vs fleet"],
  ])("%s survives — %s", (doc) => {
    expect(existsSync(repoPath(doc))).toBe(true);
  });
});
