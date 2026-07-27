---
title: "Settings Business And Operations"
area: storefront
order: 4
---

## Use This Doc For

- `/storefront/settings`
- `/storefront/settings/business`
- `/storefront/settings/capabilities`
- `/storefront/settings/operations`
- `/admin/storefront/settings`

## Choose The Right Settings Area

The Storefront settings tabs update different sources of truth. Choose the tab
by the outcome you need, rather than repeating the same fact in several places.

| Tab | Use it for | Main effect |
| --- | --- | --- |
| **Portal** | public URL, tagline, description, contact details, hero image | changes the public storefront presentation |
| **Your Business** | mission, target market, business size and reach, address, jurisdictions, payment handling, listing status, and risk posture | updates context used by the portal, compliance logic, and AI coworkers |
| **Capabilities** | optional business capabilities supported by the selected operating model | changes which platform capabilities are declared active |
| **Operating Hours** | business timezone and open/closed schedule | changes booking availability and derives safe maintenance windows |

## Update Portal Presentation

Open **Settings → Portal**, make the smallest intended change, and select
**Save Changes**.

- **Storefront URL slug** controls the public path `/s/{slug}`. The value is
  normalized to lowercase letters, numbers, and hyphens. Changing it breaks
  existing bookmarks and shared links; update every place where the old URL was
  published.
- **Tagline** and **Description** provide customer-facing summary text. They
  also supply the public page's metadata and share-preview description when
  available.
- **Contact email** and **Contact phone** are storefront contact details. These
  are separate from the broader organization and business-context fields.
- **Hero image URL** must be reachable by the customer's browser. Verify the
  image loads without relying on an internal network or signed-in session.

If the storefront is already published, presentation and slug changes affect
the live customer experience as soon as the save completes. Open **View Live**
after every change. If the change is wrong, restore the prior value and save
again; for a slug change, restore the old slug as quickly as possible.

## Keep Business Context Current

Use **Settings → Your Business** for facts that describe the organization and
shape platform decisions. The form may begin with suggestions from onboarding,
but the operator remains responsible for confirming them.

Start with the description, mission, target market, source system, company
size, geographic scope, and business address. The address can derive the
business timezone. Then review the jurisdiction detail:

- where the business operates;
- where customers are located;
- where employees work;
- where data must remain;
- whether the business handles card payments; and
- listing status when the business operates in the United Kingdom.

These are operational and compliance inputs, not marketing decoration.
Jurisdiction and payment answers can change which regulatory obligations are
applicable. The risk-posture choice also affects how much autonomy AI coworkers
receive for routine work versus when they should request human judgment.

Select **Save** and wait for **Saved successfully**. Reopen the page when the
change is consequential and confirm the persisted values. Changing business
context does not replace the Storefront's dedicated tagline, description, or
contact fields; update **Portal** separately when the public presentation must
also change.

## Set Hours And Timezone Safely

Open **Settings → Operating Hours** and set the timezone first. All displayed
hours, customer booking availability, and the platform's maintenance /
self-upgrade window are evaluated in that timezone.

For each day:

1. Turn the day on when the business accepts work and off when it is closed.
2. Set opening and closing times. Closing must be later than opening.
3. Review every day, including weekends, then select **Save Operating Hours**.

At least one day must remain open. Saving confirms the business-hours profile,
recalculates low-traffic and deployment windows, and refreshes the primary
active provider's regular availability when one exists. This means the effect
is broader than the hours shown in the footer: a published booking storefront
can offer different customer slots immediately, and platform maintenance can
move to different local times.

After saving, use **View Live** and exercise the booking calendar if the
archetype supports bookings. If a provider has a special schedule or date
exception, review it under **Team** as well; the weekly business schedule is
not a substitute for provider-specific exceptions.

## Verification And Recovery

For any consequential settings change:

1. Record the old value before editing, especially the slug, timezone, and
   operating hours.
2. Save one coherent change at a time and wait for the success state.
3. Open the public storefront and check the affected customer path.
4. Check the internal downstream surface: compliance for jurisdiction changes,
   coworker behavior for risk-posture changes, or booking availability and
   maintenance timing for hours changes.
5. Restore the prior value if the outcome is wrong. Unpublish the storefront
   first when customers should not encounter the transition.

## What To Watch

- storefront presentation diverging from the actual business context
- changing the slug without updating shared links and bookmarks
- assuming a successful save means an external hero image or customer flow works
- jurisdiction, card-payment, listing, or data-residency answers being treated
  as optional copy
- changing timezone or hours without checking booking slots and the maintenance
  window
- assuming business-wide hours cover provider-specific availability or exceptions
- editing a published storefront without verifying the public impact

## Related

- [Setup And Launch](./setup-and-launch.md) — create, readiness-check, publish, and verify the public portal.
- [Storefront](./index.md) — archetypes, sections, items, service lines, and recovery.
