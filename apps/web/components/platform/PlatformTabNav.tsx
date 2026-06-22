// EP-NAV-COHERENCE P1: Platform and Admin now render ONE operator-console tab row, so
// crossing /platform <-> /admin changes only the active family, never the whole context.
// This re-exports the shared ConsoleTabNav under the historical PlatformTabNav name so
// every existing /platform render site keeps working without a rewire.
export { ConsoleTabNav as PlatformTabNav } from "@/components/console/ConsoleTabNav";
