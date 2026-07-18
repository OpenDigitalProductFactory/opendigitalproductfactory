import { describe, expect, it } from "vitest";

import { collectSnmpDiscovery, type SnmpDeps } from "./snmp";

const ENT_PHYSICAL_SERIAL = "1.3.6.1.2.1.47.1.1.1.1.11";

/** Fake SNMP session: sys* GET returns identity; the entPhysicalSerialNum subtree feeds
 *  `serial` (a list — the first non-empty wins), everything else walks empty. */
function fakeDeps(serial: string[]): SnmpDeps {
  return {
    createSession: () => ({
      get: (_oids, cb) =>
        cb(null, [
          { oid: "1.3.6.1.2.1.1.1.0", type: 4, value: "Test Switch" },
          { oid: "1.3.6.1.2.1.1.5.0", type: 4, value: "sw-core-01" },
          { oid: "1.3.6.1.2.1.1.6.0", type: 4, value: "Rack 3" },
        ]),
      subtree: (oid, _max, feedCb, doneCb) => {
        if (oid === ENT_PHYSICAL_SERIAL && serial.length > 0) {
          feedCb(serial.map((s, i) => ({ oid: `${ENT_PHYSICAL_SERIAL}.${i + 1}`, type: 4, value: s })));
        }
        doneCb(null);
      },
      close: () => {},
    }),
  };
}

describe("collectSnmpDiscovery — hardware serial (ENTITY-MIB)", () => {
  it("captures the first non-empty entPhysicalSerialNum as attributes.serialNumber", async () => {
    const result = await collectSnmpDiscovery(undefined, [{ address: "10.0.0.1" }], fakeDeps(["", "CHASSIS-SN-42"]));
    const host = result.items.find((i) => i.itemType === "host");
    expect(host).toBeDefined();
    expect(host!.attributes?.sysName).toBe("sw-core-01");
    expect(host!.attributes?.serialNumber).toBe("CHASSIS-SN-42");
  });

  it("omits serialNumber when the device reports no serial", async () => {
    const result = await collectSnmpDiscovery(undefined, [{ address: "10.0.0.2" }], fakeDeps([]));
    const host = result.items.find((i) => i.itemType === "host");
    expect(host).toBeDefined();
    expect(host!.attributes && "serialNumber" in host!.attributes).toBe(false);
  });
});
