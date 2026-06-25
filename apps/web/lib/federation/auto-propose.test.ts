import { describe, expect, it, vi } from "vitest";
import { autoDiagnoseAndSendProposal, type AutoProposeDb } from "./auto-propose";

const incident = {
  incidentKey: "edge-incident|node|x|t",
  summary: "interface down on fw-01",
  highestSeverity: "error",
  eventClass: "interface_down",
};

function db(link: { role: string; peerTokenEnc: string | null } | null) {
  return {
    federationLink: {
      findUnique: vi.fn().mockResolvedValue(
        link ? { linkId: "link_1", peerAuthorityUrl: "https://customer.example", ...link } : null,
      ),
    },
  } as unknown as AutoProposeDb;
}

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
}

describe("autoDiagnoseAndSendProposal", () => {
  it("only the managing (MSP) side proposes", async () => {
    const res = await autoDiagnoseAndSendProposal(db({ role: "managed-by", peerTokenEnc: "t" }), "link_1", incident);
    expect(res).toEqual({ sent: false, reason: "not-managing-side" });
  });

  it("needs the peer token to send", async () => {
    const res = await autoDiagnoseAndSendProposal(db({ role: "manages", peerTokenEnc: null }), "link_1", incident);
    expect(res).toEqual({ sent: false, reason: "no-peer-token" });
  });

  it("diagnoses and sends a proposal to the customer over the link", async () => {
    const f = okFetch();
    const res = await autoDiagnoseAndSendProposal(
      db({ role: "manages", peerTokenEnc: "dpflink_peertoken" }),
      "link_1",
      incident,
      { fetchImpl: f },
    );
    expect(res).toEqual({ sent: true });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://customer.example/api/v1/federation/proposal");
    const sent = JSON.parse(init.body as string);
    expect(sent.type).toBe("dpf.federation.proposal");
    expect(sent.data.incidentKey).toBe(incident.incidentKey);
    // interface_down -> read-only diag (auto) + medium restart (needs human) => overall needs-human.
    expect(sent.data.overallDecision).toBe("needs-human-approval");
  });
});
