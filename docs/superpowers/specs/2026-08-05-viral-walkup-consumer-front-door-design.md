# Viral Walk-Up Consumer Front Door — Geo-Surfaced, Login-Optional, Order-Before-You-Sit

**Date:** 2026-08-05
**Status:** Draft — for operator review
**Epic:** EP-MOBILE-IOS-APP (mobile) + Town super-app program (EP — multi-business)
**Extends:** [`2026-06-14-multi-business-town-super-app-design.html`](2026-06-14-multi-business-town-super-app-design.html) (Nearby directory), [`2026-06-14-native-mobile-archetype-apps-design.html`](2026-06-14-native-mobile-archetype-apps-design.html) (install-driven app)
**Origin:** Founder vision, restated 2026-08-05: "use the address of the business and the geo-location of the customer's phone to add the business as the virtual interface for it — for a restaurant the menu is immediately available, and I may be able to place an order before I even sit down. The customer aspect is more community-driven and viral."

## 1. The gap this closes

The Town super-app spec captured the **discovery mechanism** (a hosted "Nearby" directory mapping geo → install URL) and the multi-business "spaces" client. It did **not** capture the **consumer experience** the founder describes. Every connected space today assumes `connect (URL/QR) → login → persona`. That is the *known-relationship* model (an employee, or a returning customer with an account).

The viral consumer front door is the inverse and was never specified:

| Dimension | Captured model (Town spec) | This spec (viral front door) |
|---|---|---|
| Entry | Type/scan an install URL | Phone geo-location matches a business address → it just appears |
| First screen | Login | The **menu / offering**, immediately, anonymous |
| Identity | Required up front | **Deferred** — none needed to browse; guest identity only at order/checkout |
| Relationship | Pre-existing (employee / account holder) | **None** — first contact, walk-up, one-off |
| Growth | Install-driven onboarding | **Viral** — presence creates the interface; using it is the signup |

Observed defect that motivated the restatement: connecting the running app to a restaurant install dropped the user into an **employee login**. For a walk-up diner that is categorically wrong — there should be no connect step and no login to see a menu.

## 2. Product narrative (the diner's 60 seconds)

1. Diner walks toward / into a restaurant that runs DPF.
2. The DPF app (already on their phone from any prior business) shows a **"Right here"** card: *"You're at &lt;the restaurant&gt; — see the menu"* — surfaced by matching the phone's coarse geo to the restaurant's published address geofence. No typing, no QR required (QR is a fallback / accelerant, not the primary path).
3. Tap → the **menu loads instantly, anonymously**. Full catalog, prices, photos, availability. No account.
4. Diner builds an order. Still anonymous.
5. At **"Place order,"** the app asks for the *minimum* identity the action needs — a name + phone for a takeaway/pickup, or a table number for dine-in — as a **guest**. Payment via the device wallet (each business's own processor; DPF is conduit not broker; physical-service IAP-exempt per Apple 3.1.3(e)).
6. Optionally, *after* a successful order: "Save this so it remembers you next time?" → one-tap upgrade of the guest into a `CustomerContact`. Never a precondition.
7. The business now exists in the diner's "my town" — community-driven, because presence + one order is the whole funnel.

## 3. Why the current architecture blocks this (and what already helps)

- **`proxy.ts` + `classifyRoute`** gate most routes behind auth. The public storefront (`/s/<slug>`, `/api/storefront/*`) is already classified `PublicApi`/`Storefront` (anonymous-capable) — **this is the substrate the front door rides.** The mobile app simply never used it; it used the authenticated `/api/v1/*` persona surface and its connect→login flow.
- **Catalog substrate exists**: `CatalogItem` / `CatalogSku` / `CatalogPriceList` / `CatalogChannelEligibility` (schema.prisma). A restaurant menu is a catalog projection — no new menu model required, a **menu view over the catalog** filtered to a consumer channel.
- **Guest order/booking exists in pieces**: `/api/storefront/orders`, `/api/storefront/bookings` with a guest path. Needs consolidation into a coherent **guest-order contract** (anonymous create → deferred identity → optional account upgrade).
- **Discovery exists as a directory** (Town M4/M5) but is **URL-centric** (slug/email → install URL). The front door needs it **geo-centric and reverse**: `(lat,lng) → nearby public storefront descriptors`, returning enough to render the "Right here" card without auth.
- **Identity convergence helps**: AGENTS §11 `PrincipalAlias`/`Principal` already anticipates a `CustomerContact` alias. A guest is a `Principal` with a weak/anonymous alias that a later account upgrade strengthens — no parallel identity table.

## 4. The four things to build (each its own BI)

1. **Geo-reverse discovery** — `GET /api/directory/nearby?lat&lng` (public) returns nearby **consumer** storefront descriptors (name, archetype, address-geofence, public menu URL, brand). Extends the Town directory from "slug→URL phonebook" to "geo→storefront." Privacy: coarse geo, opt-in on both sides, business publishes an address geofence explicitly.
2. **Anonymous consumer surface in the mobile app** — a persona `kind: "visitor"` (below `customer`) whose home is the **geo-surfaced storefront**, not a login. Menu/catalog rendered from the public storefront API. No auth to browse. This is the missing default the app needs so a walk-up never sees an employee login.
3. **Guest order contract** — anonymous cart → `POST /api/storefront/orders` as guest (name/phone or table number captured at submit, not before) → device-wallet payment → order confirmation. Optional post-order `CustomerContact` upgrade (guest Principal → account).
4. **Order-to-context binding** — dine-in "before you sit": bind an order to a table (QR on the table, or geofence + table pick); takeaway/pickup binds to a time. Reuses `StorefrontBooking`/order + the restaurant capacity substrate (2026-07-22/07-30 owner specs) so the owner cockpit sees the walk-up order like any other.

## 5. Decisions required before build (WWWD / kernel)

- **A · Anonymous identity model.** Guest = ephemeral `Principal` + weak `PrincipalAlias`, upgraded on opt-in? Or a cookie/device-token cart with no Principal until checkout? *Rec: device-token cart pre-checkout; mint a guest Principal at order submit; offer alias-strengthening after.* Needs the Decision Perspective Gate (customer-business decision, not platform WWMD).
- **B · Geofence trust & privacy.** How coarse is the geo match; is presence ever shared with the business pre-order; how does a business claim/verify its address geofence to prevent spoofing a competitor's location. *Rec: client-side coarse match against publicly-published geofence; nothing sent to the business until the diner acts.*
- **C · Discovery host.** Same OSS-supporting-company-hosted opt-in directory as Town M5, extended with geo + public menu descriptor — or separate. *Rec: extend the M5 directory; single federation surface.*
- **D · Payment at guest checkout.** Device wallet → each business's own processor (no central broker), IAP-exempt physical service. Confirm the guest-payment path doesn't require an account. *Rec: yes, guest pay via wallet; account optional.*

## 6. Research & benchmarking (design-research-required)

- **WeChat / Alipay mini-programs** — the canonical "scan/geo → merchant interface with no install, browse + order + pay, identity via the super-app wallet" model. *Adopt:* presence-creates-interface, wallet-mediated guest pay. *Reject:* central identity broker as a *requirement* (we keep it optional per Town spec).
- **Square / Toast / Sunday — QR order-at-table** — dine-in "order before a server comes" is a proven restaurant pattern; QR-on-table binds order→table with no login. *Adopt:* table binding, guest order, pay-at-table. *Gap we fill:* geo-surfacing the venue *before* the QR, and one app across many venues rather than a per-venue web page.
- **Apple App Clips / Android Instant Apps** — no-install, geo/NFC/QR-triggered, task-scoped mini-experiences with deferred sign-in. *Adopt:* the deferred-auth, task-first UX contract; the "minimum identity for the action" principle. *Note:* we deliver it inside the one installed DPF app rather than as ephemeral clips, which keeps the "my town" accretion.
- **DoorDash / Yelp / Google Maps** — geo-discovery of nearby food with menus pre-auth. *Adopt:* discovery-then-menu with no account. *Reject:* aggregator-owns-the-customer model — DPF keeps each business sovereign (single-org-per-install; directory is a phonebook, not a marketplace intermediary).
- **Anti-pattern rejected:** forcing account creation to view a menu (kills the viral loop; it's the exact defect this spec removes).

## 7. Relationship to the two-sided model

This is the **customer/community half** the founder always described as "more viral," distinct from the **employee half** (field-tech operational surface, EP-MOBILE-IOS-APP). Same generic binary, three consumer-facing tiers now instead of two:

- **visitor** (new) — anonymous, geo-surfaced, menu-first, guest order. The viral front door.
- **customer** — returning, has a `CustomerContact`; My Visits / My Invoices / saved payment.
- **employee** — operational surface (jobs, capture, invoice, collect).

A visitor becomes a customer by choosing to be remembered after an order — the funnel is *use first, sign up maybe*.

## 8. Out of scope (this spec)

- The employee operational home surface (separate, already noted under EP-MOBILE-IOS-APP).
- Aggregator/marketplace features (ratings marketplace, cross-business search ranking) — DPF stays a phonebook + sovereign storefronts.
- Delivery logistics / courier dispatch.

## 9. Next steps

1. Operator review of §5 decisions (A–D), routed through the Decision Perspective Gate for the customer-business ones.
2. On approval, file the four §4 BIs under EP-MOBILE-IOS-APP + the Town program epic.
3. Build order: geo-reverse discovery → anonymous visitor surface + menu → guest order → order-to-table binding.
