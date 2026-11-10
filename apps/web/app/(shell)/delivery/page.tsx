import { permanentRedirect } from "next/navigation";

// EP-2FB6C0CC (spec §9.3): the Delivery hub was a page of links to delivery
// surfaces. The Improve & deliver area home replaces it: Work, Team and Setup,
// with requests, builds and change flow in the rail and the Requests tab row.
// Kept as a redirect so old links and bookmarks land in the right place.
export default function DeliveryRedirect() {
  permanentRedirect("/area/delivery");
}
