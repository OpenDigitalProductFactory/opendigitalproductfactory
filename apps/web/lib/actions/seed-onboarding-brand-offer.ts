"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";

export type SeedOfferResult =
  | { success: true; threadId?: string }
  | { success: false; error: string };

const ONBOARDING_CONTEXT_KEY = "coworker:/setup";

const OFFER_MESSAGE = `Nice work — your storefront is set up. Want me to build a full design system for you in the background? I'll pull colors, typography, and components from your website (and any logos you upload), and you can keep exploring while I work. Takes about a minute.

Reply with "yes, use https://yourcompany.com" (or wherever your existing site lives) to get started. Or "skip" if you'd rather set this up later — you can always do it from Admin > Branding.`;

/**
 * Seed the opening message of the admin tour in the onboarding-coo
 * thread so first-run users discover the brand-extraction capability
 * without hunting through admin menus. Called from the SetupWizard's
 * completion callback.
 *
 * Idempotent: only seeds if the thread doesn't already exist (per-user).
 * Re-running after the thread exists is a no-op.
 */
export async function seedOnboardingBrandOffer(): Promise<SeedOfferResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }
  const userId = session.user.id;

  const existing = await prisma.agentThread.findUnique({
    where: { userId_contextKey: { userId, contextKey: ONBOARDING_CONTEXT_KEY } },
    select: { id: true },
  });
  if (existing) {
    return { success: true, threadId: existing.id };
  }

  const thread = await prisma.agentThread.create({
    data: { userId, contextKey: ONBOARDING_CONTEXT_KEY },
  });

  try {
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: OFFER_MESSAGE,
      },
    });
  } catch {
    // Non-fatal — thread exists with the right shape; the user can
    // still interact. The offer message is a nice-to-have.
  }

  return { success: true, threadId: thread.id };
}
