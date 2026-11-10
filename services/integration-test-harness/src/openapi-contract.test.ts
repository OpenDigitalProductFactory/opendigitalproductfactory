import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  UnsupportedContractError,
  createContractFromSource,
  createVendorContract,
} from "./openapi-contract.js";
import { loadVendors } from "./vendor-registry.js";

const vendorRoot = join(import.meta.dirname, "..", "vendors");

describe("openapi-contract against the committed vendor specs", () => {
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

  it("loads every committed vendor spec and serves every declared route", async () => {
    const vendors = await loadVendors(vendorRoot);
    expect(vendors.length).toBeGreaterThanOrEqual(2);
    for (const vendor of vendors) {
      const contract = await createVendorContract(vendor);
      for (const route of vendor.routes) {
        // reportName is an enum in the QuickBooks spec; every other path id is free text.
        const pathname = route.path.replace(/\{([^}]+)\}/g, (_, name: string) => (name === "reportName" ? "ProfitAndLoss" : "id-1"));
        const isForm = route.method === "POST";
        const response = await contract.mock({
          method: route.method,
          pathname,
          searchParams: new URLSearchParams(),
          headers: isForm ? { "content-type": "application/x-www-form-urlencoded" } : {},
          body: isForm ? formBodyFor(vendor.slug) : undefined,
        });
        expect(response.status, `${vendor.slug} ${route.key}`).toBeGreaterThanOrEqual(200);
        expect(response.status, `${vendor.slug} ${route.key}`).toBeLessThan(300);
      }
    }
  });
});

function formBodyFor(slug: string): string {
  return slug === "quickbooks"
    ? new URLSearchParams({ grant_type: "authorization_code", code: "c", redirect_uri: "https://x" }).toString()
    : new URLSearchParams({ grant_type: "client_credentials", client_id: "i", client_secret: "s" }).toString();
}

const SPEC = `
openapi: 3.0.3
info: { title: t, version: "1" }
paths:
  /things/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
        - name: limit
          in: query
          schema: { type: integer }
        - name: x-tenant
          in: header
          required: true
          schema: { type: string, enum: [a, b] }
      responses:
        "200":
          description: ok
          content:
            application/json:
              example: { thing: { id: "1", count: 2 } }
              schema: { $ref: "#/components/schemas/ThingEnvelope" }
  /token:
    post:
      requestBody:
        required: true
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              required: [grant_type]
              properties:
                grant_type: { type: string, enum: [client_credentials] }
          application/json:
            schema:
              type: object
              required: [grant_type]
              properties:
                grant_type: { type: string }
                scopes: { type: array, items: { type: string } }
      responses:
        "201":
          description: made
          content:
            application/json:
              example: { access_token: tok }
components:
  schemas:
    ThingEnvelope:
      type: object
      required: [thing]
      properties:
        thing: { $ref: "#/components/schemas/Thing" }
    Thing:
      type: object
      required: [id]
      properties:
        id: { type: string }
        count: { type: integer, nullable: true }
`;

function details(error: unknown) {
  expect(error).toBeInstanceOf(ContractValidationError);
  return (error as ContractValidationError).details;
}

describe("openapi-contract request and response validation", () => {
  const contract = createContractFromSource(SPEC);
  const get = (overrides: Partial<Parameters<typeof contract.mock>[0]> = {}) =>
    contract.mock({
      method: "GET",
      pathname: "/things/abc",
      searchParams: new URLSearchParams({ limit: "5" }),
      headers: { "x-tenant": "a" },
      ...overrides,
    });

  it("serves the example through $ref chains with the first 2xx status", async () => {
    const response = await get();
    expect(response).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { thing: { id: "1", count: 2 } },
    });
  });

  it("returns a copy, so a caller cannot mutate the spec example", async () => {
    const first = await get();
    (first.body as { thing: { id: string } }).thing.id = "mutated";
    expect(((await get()).body as { thing: { id: string } }).thing.id).toBe("1");
  });

  it("rejects a missing required header and an out-of-enum header", async () => {
    const missing = await get({ headers: {} }).catch((e: unknown) => e);
    expect(details(missing)).toEqual([expect.objectContaining({ code: "required", path: ["header", "x-tenant"] })]);
    const wrong = await get({ headers: { "x-tenant": "z" } }).catch((e: unknown) => e);
    expect(details(wrong)).toEqual([expect.objectContaining({ code: "enum", path: ["header", "x-tenant"] })]);
  });

  it("accepts an absent optional query parameter and rejects a non-integer one", async () => {
    await expect(get({ searchParams: new URLSearchParams() })).resolves.toMatchObject({ status: 200 });
    const bad = await get({ searchParams: new URLSearchParams({ limit: "1.5" }) }).catch((e: unknown) => e);
    expect(details(bad)).toEqual([expect.objectContaining({ code: "type", path: ["query", "limit"] })]);
  });

  it("rejects an unknown route as a contract failure", async () => {
    const error = await contract.mock({ method: "GET", pathname: "/nope", searchParams: new URLSearchParams() }).catch((e: unknown) => e);
    expect(details(error)).toEqual([expect.objectContaining({ code: "route" })]);
  });

  it("validates a form body, a JSON body, and the declared content type", async () => {
    const post = (body: string, contentType: string) =>
      contract.mock({ method: "POST", pathname: "/token", searchParams: new URLSearchParams(), headers: { "Content-Type": contentType }, body });

    await expect(post("grant_type=client_credentials", "application/x-www-form-urlencoded; charset=utf-8")).resolves.toMatchObject({ status: 201 });
    await expect(post(JSON.stringify({ grant_type: "x", scopes: ["a"] }), "application/json")).resolves.toMatchObject({ status: 201 });

    expect(details(await post("grant_type=password", "application/x-www-form-urlencoded").catch((e: unknown) => e))).toEqual([
      expect.objectContaining({ code: "enum", path: ["body", "grant_type"] }),
    ]);
    expect(details(await post(JSON.stringify({ scopes: [1] }), "application/json").catch((e: unknown) => e))).toEqual([
      expect.objectContaining({ code: "required", path: ["body", "grant_type"] }),
      expect.objectContaining({ code: "type", path: ["body", "scopes", "0"] }),
    ]);
    expect(details(await post("{not json", "application/json").catch((e: unknown) => e))).toEqual([
      expect.objectContaining({ code: "body" }),
    ]);
    expect(details(await post("a=b", "text/plain").catch((e: unknown) => e))).toEqual([
      expect.objectContaining({ code: "content-type" }),
    ]);
    expect(details(await post("", "application/json").catch((e: unknown) => e))).toEqual([
      expect.objectContaining({ code: "required", path: ["body"] }),
    ]);
  });

  it("fails when the served example violates its own schema", async () => {
    const broken = createContractFromSource(SPEC.replace('example: { thing: { id: "1", count: 2 } }', 'example: { thing: { count: "two" } }'));
    const error = await broken.mock({ method: "GET", pathname: "/things/a", searchParams: new URLSearchParams(), headers: { "x-tenant": "a" } }).catch((e: unknown) => e);
    expect(details(error)).toEqual([
      expect.objectContaining({ code: "required", path: ["response", "thing", "id"] }),
      expect.objectContaining({ code: "type", path: ["response", "thing", "count"] }),
    ]);
  });
});

describe("openapi-contract refuses what it does not support, at load time", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["an unsupported schema keyword", SPEC.replace("id: { type: string }\n        count", "id: { type: string, pattern: x }\n        count"), /unsupported schema keyword "pattern"/],
    ["a combinator", SPEC.replace('thing: { $ref: "#/components/schemas/Thing" }', "thing: { oneOf: [{ type: string }] }"), /unsupported schema keyword "oneOf"/],
    ["a remote $ref", SPEC.replace('"#/components/schemas/Thing"', '"other.yaml#/Thing"'), /only local/],
    ["a dangling $ref", SPEC.replace('"#/components/schemas/Thing"', '"#/components/schemas/Missing"'), /does not resolve/],
    ["an operation with no example", SPEC.replace("              example: { access_token: tok }\n", "              schema: { type: object }\n"), /an "example" is required/],
    ["an unsupported method", SPEC.replace("  /token:\n    post:", "  /token:\n    put:"), /method "put" is not supported/],
    ["an unsupported request content type", SPEC.replace("application/x-www-form-urlencoded:", "multipart/form-data:"), /unsupported content type/],
    ["OpenAPI 3.1", SPEC.replace("openapi: 3.0.3", "openapi: 3.1.0"), /only OpenAPI 3\.0/],
  ];

  for (const [label, source, message] of cases) {
    it(`rejects ${label}`, () => {
      expect(source).not.toBe(SPEC);
      expect(() => createContractFromSource(source)).toThrow(UnsupportedContractError);
      expect(() => createContractFromSource(source)).toThrow(message);
    });
  }
});
