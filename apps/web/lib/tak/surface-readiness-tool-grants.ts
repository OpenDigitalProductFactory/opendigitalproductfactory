/** One grant home for the central registry and surface-readiness pack. */
export const SURFACE_READINESS_TOOL_GRANTS: Record<string, string[]> = {
  record_surface_readiness: ["work_capsule_write"],
  get_fleet_readiness: ["work_capsule_read"],
  // Both owned headless credentials carry the existing build scope.
  issue_grok_credentials_client: ["sandbox_execute"],
  issue_source_credentials_client: ["sandbox_execute"],
};
