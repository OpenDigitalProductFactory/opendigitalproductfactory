import { createInstance, getHttpOperationsFromSpec, type IHttpRequest } from "@stoplight/prism-http";
import pino from "pino";

import type { LoadedVendorDefinition } from "./types.js";

const prism = createInstance(
  {
    checkSecurity: false,
    validateRequest: true,
    validateResponse: true,
    errors: false,
    upstreamProxy: undefined,
    isProxy: false,
    mock: {
      dynamic: false,
    },
  },
  {
    logger: createPrismLogger(),
  },
);

export interface ContractRequestInput {
  method: "GET" | "POST";
  pathname: string;
  searchParams: URLSearchParams;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ContractResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface VendorContract {
  mock(input: ContractRequestInput): Promise<ContractResponse>;
}

export class ContractValidationError extends Error {
  readonly details: Array<{ message: string; code?: string; path?: string[] }>;

  constructor(
    message: string,
    details: Array<{ message: string; code?: string; path?: string[] }> = [],
  ) {
    super(message);
    this.name = "ContractValidationError";
    this.details = details;
  }
}

export async function createVendorContract(vendor: LoadedVendorDefinition): Promise<VendorContract> {
  const operations = await getHttpOperationsFromSpec(vendor.openapiPath);

  return {
    async mock(input: ContractRequestInput): Promise<ContractResponse> {
      const result = await prism.request(toPrismRequest(input), operations)();

      if (result._tag === "Left") {
        throw new ContractValidationError("Contract validation failed", [
          {
            message: result.left.message,
          },
        ]);
      }

      const diagnostics = [
        ...result.right.validations.input,
        ...result.right.validations.output,
      ];
      if (diagnostics.length > 0) {
        throw new ContractValidationError(
          "Contract validation failed",
          diagnostics.map(mapDiagnostic),
        );
      }

      return {
        status: result.right.output.statusCode,
        headers: normalizeHeaders(result.right.output.headers),
        body: result.right.output.body,
      };
    },
  };
}

function toPrismRequest(input: ContractRequestInput): IHttpRequest {
  const query: Record<string, string> = {};
  for (const [key, value] of input.searchParams.entries()) {
    query[key] = value;
  }

  return {
    method: input.method.toLowerCase() as IHttpRequest["method"],
    url: {
      path: input.pathname,
      query,
    },
    headers: input.headers,
    body: input.body,
  };
}

function normalizeHeaders(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string> {
  if (!headers) return {};

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]),
  );
}

function mapDiagnostic(diagnostic: {
  message: string;
  code?: string | number;
  path?: string[];
}): {
  message: string;
  code?: string;
  path?: string[];
} {
  return {
    message: diagnostic.message,
    code: typeof diagnostic.code === "string" ? diagnostic.code : undefined,
    path: diagnostic.path,
  };
}

function createPrismLogger() {
  const base = pino({
    name: "integration-test-harness",
    level: process.env.PRISM_LOG_LEVEL ?? "error",
  }) as pino.Logger & { success?: pino.LogFn };

  return attachSuccess(base) as typeof base;
}

function attachSuccess<T extends pino.Logger & { success?: pino.LogFn }>(logger: T): T {
  logger.success = logger.info.bind(logger);

  const originalChild = logger.child.bind(logger);
  logger.child = ((bindings: pino.Bindings, options?: pino.ChildLoggerOptions) => {
    const child = originalChild(bindings, options) as T;
    return attachSuccess(child);
  }) as T["child"];

  return logger;
}
