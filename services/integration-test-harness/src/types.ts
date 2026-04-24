export interface ScenarioControlInput {
  vendor: string;
  scenario: string;
  sessionId: string;
  providedToken: string | null | undefined;
}

export interface ScenarioControlDeps {
  isTestMode: boolean;
  controlToken: string;
  state: ScenarioStateStore;
  logAdminEvent: (event: HarnessAdminEvent) => Promise<void>;
}

export interface ScenarioControlResult {
  vendor: string;
  scenario: string;
  sessionId: string;
}

export interface VendorDefinition {
  slug: string;
  openapiPath: string;
  routesPath: string;
}

export interface VendorRouteDefinition {
  key: string;
  method: "GET" | "POST";
  path: string;
}

export interface LoadedVendorDefinition extends VendorDefinition {
  scenariosDir: string;
  routes: VendorRouteDefinition[];
}

export interface HarnessScenarioResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}

export type HarnessScenarioFixture = Record<string, HarnessScenarioResponse>;

export interface HarnessAdminEvent {
  kind: "scenario_flip";
  vendor: string;
  sessionId: string;
  scenario: string;
  changedAt: string;
}

export interface ScenarioStateStore {
  getScenario(vendor: string, sessionId: string): string | null;
  setScenario(vendor: string, sessionId: string, scenario: string): void;
}
