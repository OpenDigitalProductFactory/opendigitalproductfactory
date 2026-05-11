import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { resolveAgentForRoute } from "@/lib/tak/agent-routing";
import { resolveRouteContext } from "@/lib/tak/route-context-map";
import { extractQaPlanIds } from "./qa-plan-index";
import { ROUTE_CONTRACTS } from "./route-contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const qaPlan = readFileSync(join(repoRoot, "tests/e2e/platform-qa-plan.md"), "utf8");
const qaIds = extractQaPlanIds(qaPlan);
const grantMapping = getToolGrantMapping();

const SUPERUSER_CONTEXT = { platformRole: "HR-000", isSuperuser: true } as const;

describe("AI routing route contracts", () => {
  it("covers the first high-risk route families", () => {
    expect(ROUTE_CONTRACTS.map((contract) => contract.family)).toEqual([
      "build-studio",
      "ops-backlog",
      "discovery",
      "storefront",
      "marketing",
      "platform-ai",
      "finance-tax",
    ]);
  });

  it("routes each contract path to the expected coworker", () => {
    for (const contract of ROUTE_CONTRACTS) {
      const agent = resolveAgentForRoute(contract.route, SUPERUSER_CONTEXT);

      expect(agent.agentId, contract.route).toBe(contract.expectedAgentId);
      expect(agent.agentName, contract.route).toBe(contract.expectedLabel);
    }
  });

  it("delivers required route tools and non-empty grant mappings when mapped", () => {
    for (const contract of ROUTE_CONTRACTS) {
      const context = resolveRouteContext(contract.route);

      for (const toolName of contract.requiredDomainTools) {
        expect(context.domainTools, `${contract.route} missing ${toolName}`).toContain(toolName);
        if (toolName in grantMapping) {
          expect(grantMapping[toolName], `${toolName} grant mapping must be non-empty`).not.toHaveLength(0);
        }
      }
    }
  });

  it("links every route contract to real QA plan IDs", () => {
    for (const contract of ROUTE_CONTRACTS) {
      for (const qaId of contract.qaIds) {
        expect(qaIds, `${contract.route} references missing ${qaId}`).toContain(qaId);
      }
    }
  });
});
