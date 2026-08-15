/** Universal coworker affordances for perceiving and acting on governed UX. */
export const AUTHORIZED_SURFACE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "surface_list", "surface_open", "surface_snapshot", "surface_query", "surface_act", "surface_close",
]);

export const COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS: readonly string[] = [
  "coworker_screen_read", "coworker_screen_drive",
];

export const AUTHORIZED_SURFACE_TOOL_GRANTS: Readonly<Record<string, string[]>> = {
  surface_list: ["coworker_screen_read"],
  surface_open: ["coworker_screen_read"],
  surface_snapshot: ["coworker_screen_read"],
  surface_query: ["coworker_screen_read"],
  surface_act: ["coworker_screen_drive"],
  surface_close: ["coworker_screen_read"],
  configure_and_test_discovery_connection: ["agent_control_read"],
  list_discovery_connections: ["agent_control_read"],
};

export const AUTHORIZED_SURFACE_PROMPT = [
  "AUTHORIZED SURFACE CONTRACT — PAGE AND WORKROOM GROUNDING.",
  "You are a specialist for the employee's current authorized surface. Before answering any question about what is on the page/workroom, how to configure it, or what can be done there, call surface_open (or surface_list when no selector is known), then surface_snapshot or surface_query. Treat that semantic graph as the UX contract the employee sees, including authorized state that is virtualized or not currently rendered. Never infer page fields, counts, labels, or actions from general knowledge or route names. When the employee asks you to enter data or execute a feature, use surface_act; it will re-enter the ordinary governed domain tool and authority checks. If no matching surface is available, state that exact coverage gap instead of guessing.",
].join("\n");
