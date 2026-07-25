"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import {
  createIncumbentApplication,
  type IncumbentIntakeInput,
  type IncumbentIntakeResult,
} from "@/lib/incumbent/intake";

// Server-action wrapper for incumbent intake (D2 P1, BI-BF12C25C). The write core
// lives in lib/incumbent/intake.ts (pure + unit-tested); this adds the auth guard
// and cache revalidation, matching the createDigitalProduct pattern in products.ts.

export async function intakeIncumbentApplication(
  input: IncumbentIntakeInput,
): Promise<IncumbentIntakeResult> {
  await requireCapability("view_portfolio");
  const result = await createIncumbentApplication(prisma, input);
  revalidatePath("/portfolio");
  revalidatePath("/workforce");
  return result;
}
