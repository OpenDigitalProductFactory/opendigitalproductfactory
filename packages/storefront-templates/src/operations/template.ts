export type TwinTemplate =
  | "FLOOR" // tables/stations + seats on a floor plan (food-hospitality)
  | "TERRITORY" // fleet/techs/posts/units on a zone map (dispatch-native)
  | "YARD" // pooled assets in bays (reservation-and-return)
  | "BAYS" // work orders on lifts/bays/benches (fixed-location repair)
  | "BOOK" // providers x chairs/rooms on a day grid (appointment services)
  | "ROOMS" // rooms/beds/kennels occupancy board (overnight/occupancy)
  | "STORE" // shelves/stock + POS lanes + fulfilment (point-of-sale retail)
  | "VENUE" // seat/space map + run-of-show timeline (ticketed events)
  | "COUNTER" // service counters/case stations (statutory/public services)
  | "DOCK" // dock doors + racking + pick faces (custody-and-fulfilment warehousing)
  | "TENANTS" // accounts/tenants x health/usage/seats (board — SaaS/banking)
  | "PIPELINE" // matters/engagements/productions x stage (board — prof-svcs/media)
  | "PROGRAMS";
