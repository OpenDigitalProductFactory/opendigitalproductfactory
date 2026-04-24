import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createVendorContract } from "./prism-contract.js";
import { loadVendors } from "./vendor-registry.js";

const vendorRoot = join(import.meta.dirname, "..", "vendors");

describe("prism-contract", () => {
  it("generates a contract-backed happy-path response for a valid ADP request", async () => {
    const [adpVendor] = await loadVendors(vendorRoot);
    const contract = await createVendorContract(adpVendor!);

    const response = await contract.mock({
      method: "GET",
      pathname: "/hr/v2/workers",
      searchParams: new URLSearchParams({ $top: "1" }),
      headers: {
        accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toMatchObject({
      workers: [
        {
          associateOID: "G3QZ9WB3KH1234567",
        },
      ],
    });
  });

  it("rejects invalid query parameters against the ADP contract", async () => {
    const [adpVendor] = await loadVendors(vendorRoot);
    const contract = await createVendorContract(adpVendor!);

    await expect(
      contract.mock({
        method: "GET",
        pathname: "/hr/v2/workers",
        searchParams: new URLSearchParams({ $top: "not-a-number" }),
        headers: {
          accept: "application/json",
        },
      }),
    ).rejects.toMatchObject({
      name: "ContractValidationError",
    });
  });
});
