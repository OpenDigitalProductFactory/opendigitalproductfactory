/**
 * EP-GOLDEN-TRIANGLE — public surface of the preference-to-policy compiler.
 * See ./README.md and docs/design/golden-triangle-design.md.
 */
export * from "./types";
export {
  compileGoldenTrianglePolicy,
  GOLDEN_TRIANGLE_COMPILER_VERSION,
  GOLDEN_TRIANGLE_PRESET_VERSION,
} from "./compile";
