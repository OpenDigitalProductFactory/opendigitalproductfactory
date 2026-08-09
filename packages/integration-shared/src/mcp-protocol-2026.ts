import { Buffer } from "node:buffer";

export const MCP_PROTOCOL_VERSION_2026 = "2026-07-28" as const;
export const MCP_HEADER_MISMATCH = -32020;
export const MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022;

export type McpCacheScope = "public" | "private";

export type McpClientInfo = {
  name: string;
  version: string;
};

export type McpClientCapabilities = Record<string, unknown>;

export type ModernMcpRequestMetadata = {
  protocolVersion: typeof MCP_PROTOCOL_VERSION_2026;
  clientInfo?: McpClientInfo;
  clientCapabilities: McpClientCapabilities;
};

type McpRequest = {
  method: string;
  params?: Record<string, unknown>;
};

type HeaderValidationResult =
  | { ok: true }
  | { ok: false; code: typeof MCP_HEADER_MISMATCH; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestMeta(params: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const meta = params?.["_meta"];
  return isRecord(meta) ? meta : null;
}

export function isModernMcpRequest(headers: Headers, request: McpRequest): boolean {
  const headerVersion = headers.get("mcp-protocol-version");
  const metaVersion = requestMeta(request.params)?.["io.modelcontextprotocol/protocolVersion"];
  return headerVersion === MCP_PROTOCOL_VERSION_2026 || typeof metaVersion === "string";
}

export function readModernRequestMetadata(
  params: Record<string, unknown> | undefined,
): ModernMcpRequestMetadata | null {
  const meta = requestMeta(params);
  if (!meta) return null;

  const protocolVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const clientInfo = meta["io.modelcontextprotocol/clientInfo"];
  const clientCapabilities = meta["io.modelcontextprotocol/clientCapabilities"];
  if (
    protocolVersion !== MCP_PROTOCOL_VERSION_2026 ||
    (clientInfo !== undefined &&
      (!isRecord(clientInfo) ||
        typeof clientInfo["name"] !== "string" ||
        clientInfo["name"].length === 0 ||
        typeof clientInfo["version"] !== "string" ||
        clientInfo["version"].length === 0)) ||
    !isRecord(clientCapabilities)
  ) {
    return null;
  }

  return {
    protocolVersion,
    clientInfo:
      clientInfo === undefined
        ? undefined
        : {
            name: clientInfo["name"] as string,
            version: clientInfo["version"] as string,
          },
    clientCapabilities,
  };
}

function mismatch(message: string): HeaderValidationResult {
  return { ok: false, code: MCP_HEADER_MISMATCH, message: `Header mismatch: ${message}` };
}

function decodeMirroredHeader(value: string): string | null {
  const sentinel = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;
  const match = sentinel.exec(value);
  if (!match) {
    // Fetch Headers already prevents CR/LF injection. MCP further limits plain
    // mirrored values to safe visible ASCII without leading/trailing space.
    if (value.trim() !== value || !/^[\x20-\x7E]*$/.test(value)) return null;
    return value;
  }
  try {
    const encoded = match[1];
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) return null;
    return decoded.toString("utf8");
  } catch {
    return null;
  }
}

function mirroredName(request: McpRequest): string | null {
  const params = request.params;
  if (!params) return null;
  switch (request.method) {
    case "tools/call":
    case "prompts/get":
      return typeof params["name"] === "string" ? params["name"] : null;
    case "resources/read":
      return typeof params["uri"] === "string" ? params["uri"] : null;
    case "tasks/get":
    case "tasks/update":
    case "tasks/cancel":
      return typeof params["taskId"] === "string" ? params["taskId"] : null;
    default:
      return null;
  }
}

function methodRequiresName(method: string): boolean {
  return (
    method === "tools/call" ||
    method === "prompts/get" ||
    method === "resources/read" ||
    method === "tasks/get" ||
    method === "tasks/update" ||
    method === "tasks/cancel"
  );
}

export function validateModernHttpHeaders(
  headers: Headers,
  request: McpRequest,
): HeaderValidationResult {
  const headerVersion = headers.get("mcp-protocol-version");
  if (!headerVersion) return mismatch("required MCP-Protocol-Version header is missing");

  const metaVersion = requestMeta(request.params)?.["io.modelcontextprotocol/protocolVersion"];
  if (typeof metaVersion !== "string") {
    return mismatch("request _meta protocol version is missing");
  }
  if (headerVersion !== metaVersion) {
    return mismatch(
      `MCP-Protocol-Version header value '${headerVersion}' does not match body value '${metaVersion}'`,
    );
  }

  const headerMethod = headers.get("mcp-method");
  if (!headerMethod) return mismatch("required Mcp-Method header is missing");
  if (headerMethod !== request.method) {
    return mismatch(
      `Mcp-Method header value '${headerMethod}' does not match body value '${request.method}'`,
    );
  }

  if (!methodRequiresName(request.method)) return { ok: true };
  const bodyName = mirroredName(request);
  const rawHeaderName = headers.get("mcp-name");
  if (!rawHeaderName) return mismatch("required Mcp-Name header is missing");
  const headerName = decodeMirroredHeader(rawHeaderName);
  if (headerName === null) return mismatch("Mcp-Name header is malformed");
  if (bodyName === null || headerName !== bodyName) {
    return mismatch(
      `Mcp-Name header value '${headerName}' does not match body value '${bodyName ?? "<missing>"}'`,
    );
  }
  return { ok: true };
}

type HeaderAnnotation = {
  headerName: string;
  path: string[];
  primitiveType: "string" | "integer" | "boolean";
};

function collectHeaderAnnotations(
  schema: Record<string, unknown>,
  path: string[] = [],
  found: HeaderAnnotation[] = [],
): HeaderAnnotation[] {
  const properties = schema["properties"];
  if (!isRecord(properties)) return found;
  for (const [propertyName, rawPropertySchema] of Object.entries(properties)) {
    if (!isRecord(rawPropertySchema)) continue;
    const propertyPath = [...path, propertyName];
    const annotation = rawPropertySchema["x-mcp-header"];
    if (annotation !== undefined) {
      const primitiveType = rawPropertySchema["type"];
      if (
        typeof annotation !== "string" ||
        !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(annotation) ||
        (primitiveType !== "string" && primitiveType !== "integer" && primitiveType !== "boolean")
      ) {
        throw new Error(`invalid x-mcp-header annotation at ${propertyPath.join(".")}`);
      }
      found.push({ headerName: annotation, path: propertyPath, primitiveType });
    }
    collectHeaderAnnotations(rawPropertySchema, propertyPath, found);
  }
  return found;
}

function valueAtPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = root;
  for (const segment of path) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function mirroredPrimitiveMatches(
  decoded: string,
  value: unknown,
  primitiveType: HeaderAnnotation["primitiveType"],
): boolean {
  switch (primitiveType) {
    case "string":
      return typeof value === "string" && decoded === value;
    case "integer":
      return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        decoded.trim() === decoded &&
        decoded.length > 0 &&
        Number(decoded) === value
      );
    case "boolean":
      return typeof value === "boolean" && decoded === String(value);
  }
}

export function validateToolParameterHeaders(
  headers: Headers,
  inputSchema: Record<string, unknown>,
  argumentsValue: Record<string, unknown>,
): HeaderValidationResult {
  let annotations: HeaderAnnotation[];
  try {
    annotations = collectHeaderAnnotations(inputSchema);
  } catch (error) {
    return mismatch(error instanceof Error ? error.message : "invalid x-mcp-header annotation");
  }

  const seen = new Set<string>();
  for (const annotation of annotations) {
    const normalizedName = annotation.headerName.toLowerCase();
    if (seen.has(normalizedName)) {
      return mismatch(`duplicate x-mcp-header name '${annotation.headerName}'`);
    }
    seen.add(normalizedName);

    const bodyValue = valueAtPath(argumentsValue, annotation.path);
    const rawHeader = headers.get(`mcp-param-${annotation.headerName}`);
    if (bodyValue === null || bodyValue === undefined) {
      if (rawHeader !== null) {
        return mismatch(
          `Mcp-Param-${annotation.headerName} was supplied without a corresponding body value`,
        );
      }
      continue;
    }
    if (rawHeader === null) {
      return mismatch(`required Mcp-Param-${annotation.headerName} header is missing`);
    }
    const decoded = decodeMirroredHeader(rawHeader);
    if (
      decoded === null ||
      !mirroredPrimitiveMatches(decoded, bodyValue, annotation.primitiveType)
    ) {
      return mismatch(
        `Mcp-Param-${annotation.headerName} does not match body value at ${annotation.path.join(".")}`,
      );
    }
  }
  return { ok: true };
}

export function cacheableCompleteResult<T extends Record<string, unknown>>(
  result: T,
  ttlMs: number,
  cacheScope: McpCacheScope,
): T & { resultType: "complete"; ttlMs: number; cacheScope: McpCacheScope } {
  return {
    resultType: "complete",
    ...result,
    ttlMs: Math.max(0, Math.trunc(ttlMs)),
    cacheScope,
  };
}

export function withModernServerMetadata<T extends Record<string, unknown>>(
  result: T,
  serverInfo: McpClientInfo,
): T & { _meta: Record<string, unknown> } {
  const existingMeta = isRecord(result["_meta"]) ? result["_meta"] : {};
  return {
    ...result,
    _meta: {
      ...existingMeta,
      "io.modelcontextprotocol/serverInfo": serverInfo,
    },
  };
}
