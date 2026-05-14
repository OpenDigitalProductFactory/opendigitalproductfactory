"use server";

import { signIn } from "@/lib/auth";
import { createOrganization, createOwnerAccount } from "./setup-entities";
import { advanceStep } from "./setup-progress";

export const NEXT_SETUP_ROUTE = "/platform/ai/providers";

type FirstRunOwnerInput = {
  orgName: string;
  email: string;
  password: string;
};

/**
 * Completes the first-run account bootstrap in one server action.
 *
 * Keeping organization creation, owner creation, setup advancement, and
 * workforce sign-in in one request matches the normal login page path and
 * avoids cold-start races in client-side Auth.js sign-in.
 */
export async function bootstrapFirstRunOwner(
  setupId: string,
  input: FirstRunOwnerInput,
) {
  const orgName = input.orgName.trim();
  const email = input.email.trim();

  if (!orgName || !email || input.password.length < 8) {
    throw new Error("Organization, email, and an 8+ character password are required.");
  }

  await createOrganization(setupId, { orgName });
  await createOwnerAccount(setupId, {
    name: orgName,
    email,
    password: input.password,
  });
  await advanceStep(setupId, { orgName });

  await signIn("workforce", {
    email,
    password: input.password,
    redirectTo: NEXT_SETUP_ROUTE,
  });
}
