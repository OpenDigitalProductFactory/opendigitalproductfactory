import { z } from "zod";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const CONNECTOR_AUTH_KINDS = [
  "api-key",
  "oauth2-client-credentials",
  "oauth2-authorization-code",
  "none",
] as const;

export const CONNECTOR_CALLBACK_KINDS = ["none", "oauth", "webhook"] as const;

const nonemptyIdentifier = z.string().trim().min(1);

const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    initialDelayMs: z.number().int().min(0).max(300_000),
    maxDelayMs: z.number().int().min(0).max(300_000),
  })
  .strict()
  .refine((retry) => retry.initialDelayMs <= retry.maxDelayMs, {
    message: "initialDelayMs must not exceed maxDelayMs",
    path: ["initialDelayMs"],
  });

const operationSchema = z
  .object({
    id: nonemptyIdentifier,
    capability: nonemptyIdentifier,
    retry: retryPolicySchema,
  })
  .strict();

const syncPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("full"),
      operationId: nonemptyIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("incremental"),
      operationId: nonemptyIdentifier,
      cursorField: nonemptyIdentifier,
    })
    .strict(),
]);

export const connectorDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: nonemptyIdentifier,
    displayName: z.string().trim().min(1),
    capabilities: z.array(nonemptyIdentifier).min(1),
    auth: z
      .object({ kind: z.enum(CONNECTOR_AUTH_KINDS) })
      .strict(),
    callback: z
      .object({ kind: z.enum(CONNECTOR_CALLBACK_KINDS) })
      .strict(),
    operations: z.array(operationSchema),
    health: z
      .object({ probeIntervalSeconds: z.number().int().positive().max(86_400) })
      .strict(),
    sync: syncPolicySchema,
    authorities: z.array(
      z
        .object({
          resource: nonemptyIdentifier,
          mode: z.enum(["source", "platform", "shared"]),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((definition, context) => {
    for (const [path, values] of [
      ["capabilities", definition.capabilities],
      ["operations", definition.operations.map(({ id }) => id)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${path} must be unique`,
          path: [path],
        });
      }
    }

    if (
      definition.callback.kind === "oauth" &&
      definition.auth.kind !== "oauth2-authorization-code"
    ) {
      context.addIssue({
        code: "custom",
        message: "OAuth callbacks require authorization-code authentication",
        path: ["callback", "kind"],
      });
    }

    if (
      definition.auth.kind === "oauth2-authorization-code" &&
      definition.callback.kind !== "oauth"
    ) {
      context.addIssue({
        code: "custom",
        message: "Authorization-code authentication requires an OAuth callback",
        path: ["callback", "kind"],
      });
    }

    const declaredCapabilities = new Set(definition.capabilities);
    for (const [index, operation] of definition.operations.entries()) {
      if (!declaredCapabilities.has(operation.capability)) {
        context.addIssue({
          code: "custom",
          message: "Operation capability must be declared by the connector",
          path: ["operations", index, "capability"],
        });
      }
    }

    if (definition.sync.kind !== "none") {
      const syncOperationId = definition.sync.operationId;
      if (!definition.operations.some(({ id }) => id === syncOperationId)) {
        context.addIssue({
          code: "custom",
          message: "Sync operationId must reference a declared operation",
          path: ["sync", "operationId"],
        });
      }
    }

    const authorityResources = definition.authorities.map(({ resource }) => resource);
    if (new Set(authorityResources).size !== authorityResources.length) {
      context.addIssue({
        code: "custom",
        message: "Authority resources must be unique",
        path: ["authorities"],
      });
    }
  })
  .transform(deepFreeze);

export type ConnectorDefinition = DeepReadonly<z.infer<typeof connectorDefinitionSchema>>;
export type ConnectorAuthStrategy = ConnectorDefinition["auth"];
export type ConnectorCallbackPolicy = ConnectorDefinition["callback"];
export type ConnectorOperation = ConnectorDefinition["operations"][number];
export type ConnectorHealthPolicy = ConnectorDefinition["health"];
export type ConnectorSyncPolicy = ConnectorDefinition["sync"];
export type DataAuthorityPolicy = ConnectorDefinition["authorities"][number];

export function parseConnectorDefinition(input: unknown): ConnectorDefinition {
  return connectorDefinitionSchema.parse(input);
}

export interface ConnectorCredentialAdapter<TCredential, TSerializedCredential> {
  validate(input: unknown): Promise<TCredential>;
  serialize(credential: TCredential): Promise<TSerializedCredential>;
}

export interface ConnectorAuthenticationAdapter<TCredential, TSession> {
  authenticate(credential: TCredential): Promise<TSession>;
  refresh(session: TSession): Promise<TSession>;
}

export interface ConnectorProbeAdapter<TSession, TProbe> {
  probe(session: TSession): Promise<TProbe>;
}

export interface ConnectorHealthAdapter<TProbe, THealth> {
  health(probe: TProbe): Promise<THealth>;
}

export interface ConnectorSyncAdapter<TSession, TSyncInput, TSyncResult> {
  sync(session: TSession, input: TSyncInput): Promise<TSyncResult>;
}

export interface ConnectorCallbackAdapter<TCallbackInput, TCallbackResult> {
  handleCallback(input: TCallbackInput): Promise<TCallbackResult>;
}

export interface ConnectorAdapter<
  TCredential,
  TSerializedCredential,
  TSession,
  TProbe,
  THealth,
  TSyncInput,
  TSyncResult,
  TCallbackInput,
  TCallbackResult,
> {
  credentials: ConnectorCredentialAdapter<TCredential, TSerializedCredential>;
  authentication: ConnectorAuthenticationAdapter<TCredential, TSession>;
  probe: ConnectorProbeAdapter<TSession, TProbe>;
  health: ConnectorHealthAdapter<TProbe, THealth>;
  sync: ConnectorSyncAdapter<TSession, TSyncInput, TSyncResult>;
  callback: ConnectorCallbackAdapter<TCallbackInput, TCallbackResult>;
}
