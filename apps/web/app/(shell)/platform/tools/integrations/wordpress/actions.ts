"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { connectWordPress } from "@/lib/integrations/wordpress/connect-action";
import {
  checkWordPressConnection,
  disconnectWordPress,
  setWordPressPublicationPolicy,
} from "@/lib/integrations/wordpress/connection-operations";
import { err } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const WORDPRESS_ROUTE = "/platform/tools/integrations/wordpress";

async function canManageConnections(): Promise<boolean> {
  const session = await auth();
  return Boolean(
    session?.user &&
      can(
        {
          platformRole: session.user.platformRole,
          isSuperuser: session.user.isSuperuser,
        },
        "manage_provider_connections",
      ),
  );
}

export async function connectWordPressAction(formData: FormData) {
  if (!(await canManageConnections())) return err("You do not have permission to manage provider connections.");
  const result = await connectWordPress({
    siteUrl: String(formData.get("siteUrl") ?? ""),
    username: String(formData.get("username") ?? ""),
    applicationPassword: String(formData.get("applicationPassword") ?? ""),
  });
  revalidatePath(WORDPRESS_ROUTE);
  revalidatePath("/customer/marketing");
  return result;
}

export async function checkWordPressConnectionAction() {
  if (!(await canManageConnections())) return err("You do not have permission to manage provider connections.");
  const result = await checkWordPressConnection();
  revalidatePath(WORDPRESS_ROUTE);
  return result;
}

export async function disconnectWordPressAction() {
  if (!(await canManageConnections())) return err("You do not have permission to manage provider connections.");
  const result = await disconnectWordPress();
  revalidatePath(WORDPRESS_ROUTE);
  revalidatePath("/customer/marketing");
  return result;
}

export async function setWordPressPublicationPolicyAction(input: {
  enabled: boolean;
  consequenceConfirmed: boolean;
}) {
  if (!(await canManageConnections())) return err("You do not have permission to manage provider connections.");
  try {
    const result = await setWordPressPublicationPolicy(input);
    revalidatePath(WORDPRESS_ROUTE);
    return result;
  } catch (error) {
    return err(getErrorMessage(error));
  }
}
