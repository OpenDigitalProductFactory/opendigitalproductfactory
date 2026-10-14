import { describe, expect, it } from "vitest";
import { DELIVERY_WORKFLOW_TOOLS, deliveryReadinessFromDiscovery } from "./delivery-readiness-contract";
const statuses = () => DELIVERY_WORKFLOW_TOOLS.map(name => ({ name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true }));
describe("complete delivery authority evidence", () => {
  it("checks each stage and both permission layers rather than tool counts", () => {
    const rows = statuses();
    expect(deliveryReadinessFromDiscovery({ status: rows }).ready).toBe(true);
    for (const name of ["list_coworker_offers", "request_coworker_engagement", "review_semantic_change"]) {
      const denied = rows.map(row => row.name === name ? { ...row, agentGranted: false, callableByName: false } : row);
      expect(deliveryReadinessFromDiscovery({ count: 1000, status: denied }).missingCoworkerTools).toEqual([name]);
      expect(deliveryReadinessFromDiscovery({ status: denied }).ready).toBe(false);
    }
    const restricted = rows.map(row => ({ ...row, tokenGranted: false, callableByName: false }));
    expect(deliveryReadinessFromDiscovery({ status: restricted }).missingTokenTools).toHaveLength(rows.length);
  });
  it("refuses missing, duplicate or ambiguous evidence and accepts the canonical RPC envelope", () => {
    expect(deliveryReadinessFromDiscovery({ result: { tools: [{ name: "registry_read" }] } }).ready).toBe(false);
    const rows = statuses();
    expect(deliveryReadinessFromDiscovery({ result: { content: [{ type: "text", text: JSON.stringify({ status: rows }) }] } }).ready).toBe(true);
    expect(deliveryReadinessFromDiscovery({ status: rows.concat(rows[0]!) }).ready).toBe(false);
    expect(deliveryReadinessFromDiscovery({ status: rows.map(row => ({ ...row, agentGranted: undefined })) }).ready).toBe(false);
  });
});
