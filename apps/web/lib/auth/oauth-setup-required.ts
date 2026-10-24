/** Interactive OAuth recovery. This result grants no authority and contains no
 * credential or client-controlled URL. Service clients keep their configured flow. */
export function oauthSetupRequiredResult(
  token: { source: string; oauthIdentitySetupRequired?: boolean },
  toolName: string, requiredScope: string, grants: readonly string[],
) {
  if (token.source !== "oauth" || !token.oauthIdentitySetupRequired) return null;
  if (requiredScope === "read" && !toolName.startsWith("get_my_") && !grants.includes("work_room_read")) return null;
  const message = "This connection needs one more setup step. Reconnect DPF in your AI app and approve an assistant role.";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: "oauth_setup_required", message,
      recovery: { action: "reconnect", permissionGranted: false } },
  };
}
