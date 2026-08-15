import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateResourceBudgets,
  extractServiceBlocks,
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
