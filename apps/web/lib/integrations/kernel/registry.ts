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

export interface ConnectorRegistryEntry {
  readonly definition: ConnectorDefinition;
  readonly adapter?: unknown;
}

export interface ConnectorProjection {
  readonly schemaVersion: 1;
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly state: DeepReadonly<ConnectorSetupState>;
  readonly health: {
    readonly status: ConnectorSetupState["status"];
    readonly probeIntervalSeconds: number;
  };
}

export interface ConnectorRegistry {
  list(): readonly ConnectorRegistryEntry[];
  get(key: string): ConnectorRegistryEntry | undefined;
  getByCapability(capability: string): ConnectorRegistryEntry | undefined;
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

export function createConnectorRegistry(
  entries: readonly ConnectorRegistryEntry[],
): ConnectorRegistry {
  const sorted = [...entries].sort((left, right) =>
    left.definition.key < right.definition.key
      ? -1
      : left.definition.key > right.definition.key
        ? 1
        : 0,
  );
  const byKey = new Map<string, ConnectorRegistryEntry>();
  const byCapability = new Map<string, ConnectorRegistryEntry>();

  for (const rawEntry of sorted) {
    // Definitions are already deeply immutable. Keep adapters encapsulated and
    // stateful-capable while preventing registry entries from being rewritten.
    const entry = Object.freeze({ ...rawEntry });
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

  const stableEntries = deepFreeze([...byKey.values()]) as readonly ConnectorRegistryEntry[];

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
          ...state,
          safeProjection: structuredClone(state.safeProjection),
        },
        health: {
          status: state.status,
          probeIntervalSeconds: entry.definition.health.probeIntervalSeconds,
        },
      }) as ConnectorProjection;
    },
  });
}
