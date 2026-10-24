export type RoutingScope = {
  view: "traffic" | "evaluation";
  provider: string;
  task: string;
  data: string;
  minutes: number;
};

const DATA = new Set(["all", "public", "internal", "confidential", "restricted"]);
const WINDOWS = new Set([15, 60, 1440, 10080]);
export const DEFAULT_ROUTING_SCOPE: RoutingScope = { view: "traffic", provider: "all", task: "all", data: "all", minutes: 60 };
const identity = (value: string | null) => value && value.length <= 200 ? value : "all";

export function readRoutingScope(params: Pick<URLSearchParams, "get">): RoutingScope {
  const minutes = Number(params.get("routingWindow"));
  return {
    view: params.get("routingView") === "evaluation" ? "evaluation" : "traffic",
    provider: identity(params.get("routingProvider")),
    task: identity(params.get("routingTask")),
    data: DATA.has(params.get("routingData") ?? "") ? params.get("routingData")! : "all",
    minutes: WINDOWS.has(minutes) ? minutes : 60,
  };
}

/** Retain unrelated target query keys and encode scope; never accept a return URL. */
export function routingHref(path: string, scope: RoutingScope): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("routingView", scope.view);
  params.set("routingProvider", scope.provider);
  params.set("routingTask", scope.task);
  params.set("routingData", scope.data);
  params.set("routingWindow", String(scope.minutes));
  return `${pathname}?${params}`;
}

export function routingWindow(scope: RoutingScope, now: number): { start: Date; end: Date } {
  return { start: new Date(now - scope.minutes * 60_000), end: new Date(now) };
}
