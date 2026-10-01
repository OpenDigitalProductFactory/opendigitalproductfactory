// World country outlines for the market footprint map (BI-4EC1D572).
//
// Natural Earth 1:110m admin-0 countries (public domain), pre-projected once
// with Equal Earth and committed as SVG path data, so the map needs no runtime
// geo library, no WebGL and no network. Regenerate with the steps in README.md
// in this directory.

import data from "./world-country-paths.generated.json";

export interface WorldCountryPath {
  /** ISO 3166-1 numeric, as a zero-padded string; null for disputed areas. */
  isoNumeric: string | null;
  /** ISO 3166-1 alpha-2 (plus the customary XK for Kosovo); null when none. */
  isoA2: string | null;
  name: string;
  /** SVG path data in the `viewBox` coordinate space. */
  d: string;
}

export interface WorldCountryPaths {
  viewBox: string;
  projection: string;
  /** Outline of the whole globe, drawn behind the countries. */
  sphere: string;
  source: string;
  generatedAt: string;
  countries: WorldCountryPath[];
}

export const WORLD_COUNTRY_PATHS = data as WorldCountryPaths;
