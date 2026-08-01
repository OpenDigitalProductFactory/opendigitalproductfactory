// L1 page shells (BI-36CE8BAB). Import a shell from here so the adoption
// ratchet can see it: a route that composes a shell indirectly does not count,
// because the point is that the reading contract is declared at the top of the
// page, where a reviewer reads it.
export {
  PageShell,
  CockpitShell,
  ListShell,
  DetailShell,
  SettingsShell,
  type PageShellKind,
  type PageShellAction,
  type PageShellProps,
} from "./PageShell";
