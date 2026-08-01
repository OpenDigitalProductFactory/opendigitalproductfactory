// Retention for per-branch local-integration build images.
//
// scripts/local-ci-bounded-build.mjs tags one full portal image per candidate
// branch (dockerBuildTag() in ./local-integration-ci.mjs). Nothing ever removed
// them, so a slot accumulated one ~5GB image per branch it had ever verified.
// On 2026-07-31 that reached 72 images / ~212GB of unique layers and helped fill
// the Docker data disk to 0 bytes free, which took the ext4 filesystem
// read-only and killed Postgres with SIGBUS.
//
// Retention rule: a slot needs exactly one image — the newest one that built
// successfully. Once a working replacement exists, every older image for that
// same slot is superseded and reapable.

// Tag shape is `dpf-` + integrationBranchName().replace(/\//g, "-") + `-build`,
// i.e. `dpf-local-integration-slot-0-<branch>-build` when a slot key is given
// and `dpf-local-integration-<branch>-build` when it is not.
const SLOT_SCOPED = /^dpf-local-integration-slot-\d+-/;

export function slotImagePrefix(slotKey = "") {
  return slotKey ? `dpf-local-integration-${slotKey}-` : "dpf-local-integration-";
}

/**
 * Pure planner: which image tags for THIS slot are superseded by keepTag.
 *
 * Scoping matters. With no slotKey the prefix is the bare namespace, which
 * would also match every slot-scoped tag and let an unslotted build reap the
 * live images of concurrent slots. Unslotted builds therefore skip slot-scoped
 * tags, so a slot only ever reaps within its own namespace.
 */
export function planSlotImageReaping({ images = [], slotKey = "", keepTag = "" } = {}) {
  const prefix = slotImagePrefix(slotKey);
  const slotScoped = Boolean(slotKey);
  const seen = new Set();
  return images.filter((tag) => {
    if (typeof tag !== "string" || tag.length === 0) return false;
    if (tag === keepTag) return false;
    if (!tag.startsWith(prefix)) return false;
    if (!slotScoped && SLOT_SCOPED.test(tag)) return false;
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

/**
 * Reap superseded images for a slot. Injected listImages/removeImage keep this
 * unit-testable and keep docker out of the test path.
 *
 * Never throws: retention is housekeeping that runs AFTER a green build, and a
 * docker hiccup here must not turn a passing build red.
 */
export function reapSupersededSlotImages({
  slotKey = "",
  keepTag = "",
  listImages,
  removeImage,
  log = () => {},
} = {}) {
  const result = { planned: [], removed: [], failed: [] };
  if (!keepTag) return result;
  let images = [];
  try {
    images = listImages() ?? [];
  } catch (error) {
    log(`image-listing failed, skipping retention: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  result.planned = planSlotImageReaping({ images, slotKey, keepTag });
  for (const tag of result.planned) {
    try {
      removeImage(tag);
      result.removed.push(tag);
    } catch (error) {
      result.failed.push({ tag, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (result.removed.length > 0) {
    log(`reaped ${result.removed.length} superseded image(s) for ${slotKey || "unslotted"}, kept ${keepTag}`);
  }
  return result;
}
