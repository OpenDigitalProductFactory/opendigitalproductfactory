---
title: "Customer Map"
description: "See your customer sites on a map, find the sites that are not on it, draw the areas you serve, and see which sites fall outside them."
area: customers
order: 10
---

## Use This Doc For

- Seeing where your customer sites are
- Finding the sites that are not on the map, and why
- Placing a site on the map by hand
- Choosing a service that finds locations from addresses
- Drawing the areas you serve and seeing which sites fall outside them
- Using the map on your phone, with **Follow me**

## Open The Map

On the **Customer** page, choose **Show customers on the map**. Your workspace
home also shows how many sites are on the map. Select that line to go straight
to the map.

The account list stays on the same page. It holds the same information as the
map, so it works with a screen reader or keyboard.

## Sites That Are Not On The Map

Under the map, **Not on the map** lists every site the map cannot show yet. Each
row gives the reason:

- **No address**: the site has no address. Select **Check the address** to open
  the account and add one.
- **Address not located**: the site has an address, but no map position yet.

To place a site by hand, select **Place on the map**, then click the spot on the
map. The point is saved on the site's address. You need permission to edit
customers to do this.

## Find Locations Automatically

Administrators see **Find locations automatically** under the map. It is off by
default (**None**). When it is off, no address leaves this installation.

| Service | Best for | Notes |
| --- | --- | --- |
| **None** | Placing sites by hand | The default |
| **US Census** | US addresses | Free, no key |
| **OpenCage** | Addresses in many countries | Add an OpenCage key under **Platform → Tools → Services** first |
| **Your own Nominatim or Photon server** | Keeping addresses in-house | Enter your server's address |

Choose a service, select **Save**, then select **Find missing locations**. The
search runs in the background and only fills in sites that have no position yet.
It never overwrites a site you placed by hand. When it finishes, the panel shows
how many sites were placed, how many were not found, and how many are still
missing.

The free public Nominatim service is not offered here. Its usage policy does not
allow bulk lookups. See
[Address Validation Providers](../platform/address-validation-providers.md).

## Service Areas

A service area is a part of the map your business covers, such as a city or a
crew's patch. Once you have drawn one, the map shows which customer sites fall
outside every area you serve.

### Draw an area

You need permission to edit customers to do this.

1. Select **Add a service area**.
2. Click the map at each corner of the area. To remove the last corner you
   placed, select **Undo last point**.
3. When the area has at least three corners, select **Finish**.
4. Give the area a name. Optionally choose the crew or person who covers it
   under **Covered by**.
5. Select **Save area**.

To change an area's name or who covers it, select **Rename or reassign**. To
change its shape, delete it and draw it again. Deleting asks you to confirm.

### Read the coverage

When at least one area exists, a **Coverage** section appears under the map:

- **Outside every service area** lists the placed sites that no area covers.
  Each one links to its account.
- **In more than one area** lists sites covered by two or more areas, and which
  areas they are, so you can see where two crews might both claim a job.
- **Service areas** lists each area, who covers it and how many sites it holds.

Select a site on the map to see which area covers it and who covers that area.

Sites that are not on the map yet cannot be checked against your areas. Place
them first (see above).

Areas are drawn and checked inside this installation. Nothing is sent to an
outside service.

## On Your Phone

In the DPF phone app, open **Customers** and select **Map**. The map shows the
same sites and service areas as the web page, drawn from your own
installation's street map.

- Each site is a circle with a letter: the first letter of the customer's
  name. Tap a site to open the customer's account.
- **Follow me** keeps the map centred on where you are as you move. The app
  asks for location permission the first time. Your position stays on the
  phone; it is not sent to your installation.
- **Recenter** goes back to all your sites. Moving the map yourself turns
  **Follow me** off.
- **Legend** explains the symbols on the map.

The list under the map has every site, including the ones that are not on the
map yet. Tap a row to open the account.

If no street map is installed for the area, or the installed one does not
cover your sites, the sites and areas are drawn on a plain background and the
screen says why. An administrator can add a street map; see
[Map Packs](../platform/map-packs.md). If the map cannot load or start on the
phone, the screen says why and shows the list alone.

## Related

- [Market Footprint](market-footprint.md)
- [Customers](index.md)
