---
title: "Customer Map"
description: "See your customer sites on a map, find the sites that are not on it, and place them by hand or with a geocoding service you choose."
area: customers
order: 10
---

## Use This Doc For

- Seeing where your customer sites are
- Finding the sites that are not on the map, and why
- Placing a site on the map by hand
- Choosing a service that finds locations from addresses

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

## Related

- [Market Footprint](market-footprint.md)
- [Customers](index.md)
