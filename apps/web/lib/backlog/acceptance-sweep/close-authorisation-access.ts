import { can, type UserContext } from "@/lib/permissions";

// Who may see and change the acceptance sweep's close pre-authorisation
// (BI-45D3BBF4, BI-C2467A2E AC-2): manage_platform, because it is an operator
// setting, AND manage_backlog, because every closure runs in that operator's
// human context. The admin page and the server actions both ask this one
// question, so the card and the write it calls cannot drift apart.

export function mayManageCloseAuthorisation(user: UserContext): boolean {
  return can(user, "manage_platform") && can(user, "manage_backlog");
}
