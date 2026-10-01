# Market footprint data

`world-country-paths.generated.json` holds the country outlines drawn by the market footprint map at `/customer/footprint`.

## Source

- Natural Earth 1:110m admin-0 countries, which is public domain. It is read through the `world-atlas@2` package (ISC licence).
- The outlines are projected with Equal Earth and fitted to a 1000 × 487 viewBox.
- Paths are rounded to one decimal place.

## Regenerating

Run this outside the repository, so that no dependency is added to any workspace:

```bash
mkdir /tmp/geo && cd /tmp/geo && npm init -y && npm install world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7
```

Then run a script that does the following:

1. Read `node_modules/world-atlas/countries-110m.json`.
2. Convert it to features with `topojson-client`'s `feature()`.
3. Project each feature with `geoEqualEarth().fitSize([1000, 487], {type: "Sphere"})` and `geoPath(...).digits(1)`.
4. Map each numeric id to alpha-2 with `i18n-iso-countries`. Set Kosovo to `XK`.
5. Write `{ viewBox, projection, sphere, source, generatedAt, countries: [{ isoNumeric, isoA2, name, d }] }`.

Keep the file under 250 KB. `world-country-paths.test.ts` guards its shape.
