import type { ConnectorDefinition } from "./definition";
import {
  projectConnectorSetupState,
  type ConnectorHealthInput,
  type ConnectorSetupState,
  type ConnectorSetupStateSource,
} from "./setup-state";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type ConnectorAdapterFacade<TAdapter extends object> = {
  readonly [TKey in keyof TAdapter]: TAdapter[TKey] extends (
    ...args: infer TArgs
  ) => infer TResult
    ? (...args: TArgs) => TResult
    : DeepReadonly<TAdapter[TKey]>;
};

export interface ConnectorRegistryEntry<TAdapter extends object = Record<string, never>> {
  readonly definition: ConnectorDefinition;
  readonly adapter?: TAdapter;
}

export interface ConnectorProjectedState {
  readonly integrationId: string;
  readonly provider: string | null;
  readonly status: ConnectorSetupState["status"];
  readonly safeProjection: DeepReadonly<ConnectorSetupState["safeProjection"]>;
  readonly lastErrorMsg: string | null;
  readonly lastTestedAt: string | null;
}

export interface ConnectorProjection {
  readonly schemaVersion: 1;
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly state: ConnectorProjectedState;
  readonly health: {
    readonly status: ConnectorSetupState["status"];
    readonly probeIntervalSeconds: number;
  };
}

export interface ConnectorRegistry<TAdapter extends object = Record<string, never>> {
  list(): readonly ConnectorRegistryEntry<ConnectorAdapterFacade<TAdapter>>[];
  get(key: string): ConnectorRegistryEntry<ConnectorAdapterFacade<TAdapter>> | undefined;
  getByCapability(
    capability: string,
  ): ConnectorRegistryEntry<ConnectorAdapterFacade<TAdapter>> | undefined;
  project(
    key: string,
    source: ConnectorSetupStateSource | null,
    health?: ConnectorHealthInput,
  ): ConnectorProjection;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function createAdapterFacade<TAdapter extends object>(
  adapter: TAdapter,
): ConnectorAdapterFacade<TAdapter> {
  const facade: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(adapter)) {
    const value = Reflect.get(adapter, key);
    facade[key] = typeof value === "function"
      ? value.bind(adapter)
      : deepFreeze(structuredClone(value));
  }
  return Object.freeze(facade) as ConnectorAdapterFacade<TAdapter>;
}

export function createConnectorRegistry<TAdapter extends object = Record<string, never>>(
  entries: readonly ConnectorRegistryEntry<TAdapter>[],
): ConnectorRegistry<TAdapter> {
  const sorted = [...entries].sort((left, right) =>
    left.definition.key < right.definition.key
      ? -1
      : left.definition.key > right.definition.key
        ? 1
        : 0,
  );
  type RegisteredEntry = ConnectorRegistryEntry<ConnectorAdapterFacade<TAdapter>>;
  const byKey = new Map<string, RegisteredEntry>();
  const byCapability = new Map<string, RegisteredEntry>();

  for (const rawEntry of sorted) {
    const entry: RegisteredEntry = Object.freeze({
      definition: rawEntry.definition,
      ...(rawEntry.adapter
        ? { adapter: createAdapterFacade(rawEntry.adapter) }
        : {}),
    });
    const key = entry.definition.key;
    if (byKey.has(key)) throw new Error(`Duplicate connector key: ${key}`);
    byKey.set(key, entry);

    for (const capability of entry.definition.capabilities) {
      if (byCapability.has(capability)) {
        throw new Error(`Duplicate capability: ${capability}`);
      }
      byCapability.set(capability, entry);
    }
  }

  const stableEntries = deepFreeze([...byKey.values()]) as readonly RegisteredEntry[];

  return Object.freeze({
    list: () => stableEntries,
    get: (key: string) => byKey.get(key),
    getByCapability: (capability: string) => byCapability.get(capability),
    project(
      key: string,
      source: ConnectorSetupStateSource | null,
      health: ConnectorHealthInput = {},
    ): ConnectorProjection {
      const entry = byKey.get(key);
      if (!entry) throw new Error(`Unknown connector: ${key}`);
      const state = projectConnectorSetupState(source, key, health);
      return deepFreeze({
        schemaVersion: entry.definition.schemaVersion,
        key,
        displayName: entry.definition.displayName,
        capabilities: [...entry.definition.capabilities],
        state: {
          integrationId: state.integrationId,
          provider: state.provider,
          status: state.status,
          safeProjection: structuredClone(state.safeProjection),
          lastErrorMsg: state.lastErrorMsg,
          lastTestedAt: state.lastTestedAt?.toISOString() ?? null,
        },
        health: {
          status: state.status,
          probeIntervalSeconds: entry.definition.health.probeIntervalSeconds,
        },
      }) as ConnectorProjection;
    },
  });
}
