import { revalidateTag } from "next/cache";

export function revalidatePortalContext(): void {
  try {
    revalidateTag("portal-context", "max");
  } catch {
    // Revalidation is best-effort outside a Next request/runtime boundary.
  }
}
