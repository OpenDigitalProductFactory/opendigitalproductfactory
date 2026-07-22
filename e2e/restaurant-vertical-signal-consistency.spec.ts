// Vertical signal consistency across the four Restaurant owner surfaces
// (BI-348766E5, BI-36807E68). The reconciliation invariant: if `/storefront/inbox`
// has actionable (pending) bookings, the SAME reservation signal must be visible on
// `/workspace` and `/workspace/inbox` — it must fail when Workspace surfaces only
// generic corpus decisions while real bookings need the owner.
//
// Precondition: the Restaurant demo business must be loaded (loadDemoBusiness
// "restaurant") so there are pending StorefrontBooking rows to reconcile. When no
// pending bookings exist the reconciliation assertions skip (nothing to reconcile),
// but the row-specific action-label contract is always checked.
import { test, expect, type Page } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";

/** Accessible names of every booking Confirm/Cancel control on /storefront/inbox. */
async function bookingActionLabels(page: Page): Promise<string[]> {
  await page.goto("/storefront/inbox");
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  const bookingFilter = page.getByRole("button", { name: "Booking", exact: true });
  if (await bookingFilter.count()) {
    await bookingFilter.first().click();
    await page.waitForTimeout(200);
  }
  const buttons = page.getByRole("button", { name: /^(Confirm|Cancel)\b/ });
  const labels: string[] = [];
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    labels.push((await buttons.nth(i).getAttribute("aria-label")) ?? (await buttons.nth(i).innerText()));
  }
  return labels;
}

function guestsFromLabels(labels: string[]): string[] {
  return labels
    .map((l) => l.match(/for (.+?) on /)?.[1] ?? l.match(/^Confirm (.+)$/)?.[1] ?? null)
    .filter((g): g is string => Boolean(g) && g !== "booking" && g !== "guest");
}

test.describe("Restaurant vertical signal consistency", () => {
  test("storefront inbox Confirm/Cancel actions are row-specific, never bare", async ({ page }) => {
    await ensureLoggedIn(page);
    const labels = await bookingActionLabels(page);
    for (const label of labels) {
      // The exact terse labels the audit flagged (BI-7D7EE150) must not survive.
      expect(label.trim()).not.toBe("Confirm");
      expect(label.trim()).not.toBe("Cancel");
    }
  });

  test("pending reservations reconcile into Workspace and Workspace Inbox", async ({ page }) => {
    await ensureLoggedIn(page);
    const labels = await bookingActionLabels(page);
    const guests = guestsFromLabels(labels);

    test.skip(guests.length === 0, "No pending bookings loaded — nothing to reconcile.");

    // The Workspace Inbox must reflect the reservation work, not only generic
    // enterprise-architecture decisions. Accept either the guest by name or clear
    // reservation vocabulary.
    await page.goto("/workspace/inbox");
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    const inboxText = (await page.locator("main").innerText()).toLowerCase();
    const reservationSignal =
      guests.some((g) => inboxText.includes(g.toLowerCase())) ||
      /reservation|table for|confirm .*(?:at|booking)/i.test(inboxText);
    expect(
      reservationSignal,
      "Workspace Inbox shows only generic decisions while pending reservations need the owner",
    ).toBe(true);

    // The pathological state: every action reads the identical generic label.
    const reviewButtons = page.getByRole("link", { name: /^Review this decision$/ });
    const genericCount = await reviewButtons.count();
    const anyActionable = await page.getByRole("link", { name: /Confirm|Reschedule|Review:/ }).count();
    expect(
      genericCount === 0 || anyActionable > 0,
      "Every Workspace Inbox action is the identical 'Review this decision' label",
    ).toBe(true);

    // The Workspace home must not present a reservation signal that contradicts the
    // Storefront booking history (the "RESERVATIONS 0 Clear" mismatch).
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    const homeText = (await page.locator("body").innerText()).toLowerCase();
    const homeSignal =
      guests.some((g) => homeText.includes(g.toLowerCase())) || /reservation/i.test(homeText);
    expect(homeSignal, "Workspace home does not surface any reservation signal").toBe(true);
  });
});
