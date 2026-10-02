// The phone's customer-sites map payload (BI-3DAE2169, AC-PMR-SCENE-1): the
// same scene the web customer map draws, plus the installed packs that cover
// it, so the phone can pick a street map or say why there is none.

import { packCoveringBounds } from "@/components/twin/geographic/geographic-capability";
import type { CustomerMap } from "@/lib/crm/customer-map";
import { buildGeographicSceneModel, type GeographicSceneModel } from "@/lib/twin/geographic-scene";

import type { CustomerSitesMapResponse, MapPackSummary } from "@dpf/types";

export type CustomerSitesMapPayload = Omit<CustomerSitesMapResponse, "model"> & {
  model: GeographicSceneModel | null;
};

// The web model must stay assignable to the phone's API type.
const _contract: (payload: CustomerSitesMapPayload) => CustomerSitesMapResponse = (payload) => payload;
void _contract;

export function buildCustomerSitesMapPayload(
  map: CustomerMap,
  packs: readonly MapPackSummary[],
): CustomerSitesMapPayload {
  const notOnMap = map.unplaced.length;
  if (!map.layout) return { model: null, notOnMap, pack: null, basemap: "nothing-to-show" };
  const model = buildGeographicSceneModel({ layout: map.layout, presentations: map.presentations });
  if (packs.length === 0) return { model, notOnMap, pack: null, basemap: "no-pack-installed" };
  const covering = packCoveringBounds(packs, model.bounds);
  const pack = covering ? (packs.find((entry) => entry.packId === covering.packId) ?? null) : null;
  return { model, notOnMap, pack, basemap: pack ? "available" : "out-of-coverage" };
}
