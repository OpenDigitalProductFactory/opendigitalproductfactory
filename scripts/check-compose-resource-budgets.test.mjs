import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateLocalCiFit,
  evaluateResourceBudgets,
  extractServiceBlocks,
  parseMemoryBytes,
  serviceHasResourceLimits,
  sizeWslCeilings,
} from "./check-compose-resource-budgets.mjs";

describe("extractServiceBlocks", () => {
  it("splits top-level compose services", () => {
    const text = `
services:
  postgres:
    image: pg
    restart: unless-stopped
  portal:
    image: app
    profiles: ["x"]
volumes:
  pgdata:
`;
    const blocks = extractServiceBlocks(text);
    assert.equal(blocks.has("postgres"), true);
    assert.equal(blocks.has("portal"), true);
    assert.match(blocks.get("postgres"), /image: pg/);
  });
});

describe("serviceHasResourceLimits", () => {
  it("accepts deploy.resources.limits", () => {
    assert.equal(
      serviceHasResourceLimits(`
  portal:
    deploy:
      resources:
        limits:
          memory: 3g
          cpus: "2.0"
`),
      true,
    );
  });

  it("rejects missing limits", () => {
    assert.equal(
      serviceHasResourceLimits(`
  portal:
    restart: unless-stopped
`),
      false,
    );
  });
});

describe("evaluateResourceBudgets", () => {
  it("fails when always-on service lacks limits", () => {
    const result = evaluateResourceBudgets({
      budget: {
        alwaysOnServices: {
          postgres: { memory: "2g", cpus: "2.0" },
        },
      },
      composeText: `
services:
  postgres:
    restart: unless-stopped
    image: pg
`,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /postgres/);
  });

  it("passes when always-on service is bounded", () => {
    const result = evaluateResourceBudgets({
      budget: {
        alwaysOnServices: {
          postgres: { memory: "2g", cpus: "2.0" },
        },
      },
      composeText: `
services:
  postgres:
    restart: unless-stopped
    image: pg
    deploy:
      resources:
        limits:
          memory: 2g
          cpus: "2.0"
`,
    });
    assert.equal(result.ok, true);
  });

  it("flags uncapped always-on services missing from the budget", () => {
    const result = evaluateResourceBudgets({
      budget: { alwaysOnServices: {} },
      composeText: `
services:
  mystery:
    restart: unless-stopped
    image: x
`,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /mystery/);
  });
});

describe("sizeWslCeilings", () => {
  it("leaves OS headroom and clamps to max", () => {
    const sized = sizeWslCeilings(
      { totalMemoryGb: 64, logicalProcessors: 16 },
      {
        memoryShareOfHost: 0.5,
        leaveOsHeadroomGb: 8,
        maxMemoryGb: 32,
        processorShareOfHost: 0.75,
        minProcessors: 2,
      },
    );
    assert.equal(sized.memoryGb, 32);
    assert.equal(sized.processors, 12);
    assert.equal(sized.autoMemoryReclaim, "gradual");
  });

  it("does not exceed headroom on small hosts", () => {
    const sized = sizeWslCeilings(
      { totalMemoryGb: 16, logicalProcessors: 4 },
      {
        memoryShareOfHost: 0.5,
        leaveOsHeadroomGb: 8,
        minMemoryGb: 8,
        maxMemoryGb: 32,
        processorShareOfHost: 0.75,
        minProcessors: 2,
      },
    );
    assert.equal(sized.memoryGb, 8);
    assert.equal(sized.processors, 3);
  });
});

// BI-48EACCB0 (BI-903FB5F9 slice B): the largest VM the budget will size must
// hold the always-on stack, the measured builder reserve and the admission floor.
describe("evaluateLocalCiFit", () => {
  const GiB = 1024 ** 3;
  const budget = {
    host: { wsl: { maxMemoryGb: 32 } },
    alwaysOnServices: {
      postgres: { memory: "2g" },
      portal: { memory: "3g" },
      redis: { memory: "512m" },
      inngest: { memory: "1g" },
      loki: { memory: "1g" },
      alloy: { memory: "512m" },
    },
  };

  it("parses compose memory strings", () => {
    assert.equal(parseMemoryBytes("2g"), 2 * GiB);
    assert.equal(parseMemoryBytes("512m"), 512 * 1024 ** 2);
    assert.equal(parseMemoryBytes("1G"), GiB);
    assert.equal(parseMemoryBytes("nonsense"), null);
  });

  it("AC-1: reports headroom when the maximum VM holds always-on + reserve + floor", () => {
    const fit = evaluateLocalCiFit({ budget, builderReserveBytes: 14.86 * GiB, floorBytes: 4 * GiB });
    assert.equal(fit.ok, true);
    assert.equal(fit.alwaysOnBytes, 8 * GiB);
    assert.ok(Math.abs(fit.headroomBytes - (32 - 8 - 14.86 - 4) * GiB) < 1024);
  });

  it("AC-1: fails, naming the shortfall, when the maximum VM cannot admit a build", () => {
    const fit = evaluateLocalCiFit({
      budget: { ...budget, host: { wsl: { maxMemoryGb: 24 } } },
      builderReserveBytes: 16 * GiB,
      floorBytes: 4 * GiB,
    });
    assert.equal(fit.ok, false);
    assert.equal(fit.headroomBytes, -4 * GiB);
    assert.match(fit.message, /cannot admit a local-CI build/);
    assert.match(fit.message, /short by 4\.00 GiB/);
  });

  it("fails closed on an unreadable input rather than passing", () => {
    const fit = evaluateLocalCiFit({ budget: { host: {} }, builderReserveBytes: 14 * GiB, floorBytes: 4 * GiB });
    assert.equal(fit.ok, false);
    assert.match(fit.message, /cannot be evaluated/);
  });
});
