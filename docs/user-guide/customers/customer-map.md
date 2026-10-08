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

Once a service is chosen, new locations are found as they are saved, with no
button to press:

- a new customer site, or a site whose address changes;
- a new address for one of your business locations;
- your business's own address, saved during setup.

Each lookup runs in the background, one at a time at the service's own pace, so
saving is never slowed down. A position someone chose (a suggestion picked
from the address search, a point placed by hand, or a site confirmed on a
phone) is never replaced. Your business's own position also lets people nearby
find you through the phone app's nearby search.

The free public Nominatim service is not offered here. Its usage policy does not
allow bulk lookups. See
[Address Validation Providers](../platform/address-validation-providers.md).

## Confirm A Site's Location From The Phone

When someone checks in to a job on the phone app, and the job's site has an
address but no confirmed position, the app asks:

> Set the location of *site* from where you are now? Your phone's location is
> used once, for this site only.

- **Use my location** reads the phone's position once and saves it as the
  site's location. The phone asks for location permission at this moment, and
  only for while the app is open. If the customer has several sites, the app
  asks which one you are at.
- **Not now** hides the question for that site on this phone for 30 days.

The position is only saved when it is accurate to 50 metres or better. If it is
more than 1 kilometre from where the address was looked up, the app asks
whether you are really at the site before saving. A position someone already
chose (a picked suggestion, a point placed by hand, or an earlier phone
confirmation) is never replaced. The customer's activity history records who
confirmed the location and when.

The app does not track where staff go. It does not use location in the
background, and it keeps nothing about where a person was apart from the
site's location they chose to save.

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

## Related

- [Market Footprint](market-footprint.md)
- [Customers](index.md)
