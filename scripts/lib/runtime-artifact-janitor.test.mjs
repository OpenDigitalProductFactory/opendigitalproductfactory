import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_STALENESS_DAYS,
  MS_PER_DAY,
  ROOT_COMPOSE_PROJECT,
  ageInDays,
  decideBuildImage,
  decideComposeProject,
  decideVolumeReclaim,
  isLocalCiBuildImage,
  planReap,
} from "./runtime-artifact-janitor.mjs";

const NOW = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05T12:00:00Z
const daysAgo = (n) => NOW - n * MS_PER_DAY;

// ── isLocalCiBuildImage ──────────────────────────────────────────────────────

test("matches the dockerBuildTag() per-branch CI image convention", () => {
  assert.equal(isLocalCiBuildImage("dpf-local-integration-feat-foo-build"), true);
  assert.equal(
    isLocalCiBuildImage("dpf-local-integration-feat-build-studio-decision-skills-slice-1-build"),
    true,
  );
});

test("does not match the root portal image or other dpf images", () => {
  assert.equal(isLocalCiBuildImage("dpf-portal"), false);
  assert.equal(isLocalCiBuildImage("dpf-local-integration-feat-foo"), false); // missing -build
  assert.equal(isLocalCiBuildImage("postgres"), false);
  assert.equal(isLocalCiBuildImage("local-integration-feat-foo-build"), false); // missing dpf-
  assert.equal(isLocalCiBuildImage(""), false);
  assert.equal(isLocalCiBuildImage(undefined), false);
});

// ── ageInDays (clock-skew / unparseable clamp) ───────────────────────────────

test("ageInDays clamps negative (future-dated / clock-skew) and NaN to 0", () => {
  assert.equal(ageInDays(daysAgo(-5), NOW), 0); // created in the future
  assert.equal(ageInDays("not-a-date", NOW), 0);
  assert.equal(ageInDays(undefined, NOW), 0);
  assert.equal(Math.round(ageInDays(daysAgo(10), NOW)), 10);
});

// ── decideBuildImage: staleness threshold ────────────────────────────────────

test("CI build image past the default 7d threshold is REAPED", () => {
  const d = decideBuildImage(
    { repository: "dpf-local-integration-feat-foo-build", createdMs: daysAgo(9) },
    { nowMs: NOW },
  );
  assert.equal(d.verdict, "REAP");
  assert.match(d.reason, /local-integration-ci lease/);
});

test("CI build image younger than threshold is KEPT (idle is not abandoned)", () => {
  const d = decideBuildImage(
    { repository: "dpf-local-integration-feat-foo-build", createdMs: daysAgo(3) },
    { nowMs: NOW },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /grace/);
});

test("default staleness threshold is 7 days", () => {
  assert.equal(DEFAULT_STALENESS_DAYS, 7);
  // exactly at threshold reaps; just under keeps
  const at = decideBuildImage(
    { repository: "dpf-local-integration-x-build", createdMs: daysAgo(7) },
    { nowMs: NOW },
  );
  const under = decideBuildImage(
    { repository: "dpf-local-integration-x-build", createdMs: daysAgo(6.99) },
    { nowMs: NOW },
  );
  assert.equal(at.verdict, "REAP");
  assert.equal(under.verdict, "KEEP");
});

test("a custom staleness threshold is honored", () => {
  const d = decideBuildImage(
    { repository: "dpf-local-integration-feat-foo-build", createdMs: daysAgo(20) },
    { nowMs: NOW, stalenessDays: 30 },
  );
  assert.equal(d.verdict, "KEEP");
});

test("a non-CI image is never a reap candidate, even when ancient", () => {
  const d = decideBuildImage(
    { repository: "dpf-portal", createdMs: daysAgo(400) },
    { nowMs: NOW },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /not a dpf-local-integration/);
});

// ── decideComposeProject: never-touch-root / never-touch-live guards ──────────

test("the root dpf project is NEVER reaped, regardless of age", () => {
  const d = decideComposeProject(
    { projectName: ROOT_COMPOSE_PROJECT, newestContainerCreatedMs: daysAgo(365) },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /never reaped/);
});

test("the root dpf project is matched case-insensitively", () => {
  const d = decideComposeProject(
    { projectName: "DPF", newestContainerCreatedMs: daysAgo(365) },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "KEEP");
});

test("a dpf-<topic> project backed by a live worktree is NEVER reaped, even when old", () => {
  const d = decideComposeProject(
    { projectName: "dpf-feat-active", newestContainerCreatedMs: daysAgo(99) },
    { nowMs: NOW, liveWorktreeProjectNames: new Set(["dpf-feat-active"]) },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /live worktree/);
});

test("an orphaned dpf-<topic> project (no live worktree) past threshold is REAPED", () => {
  const d = decideComposeProject(
    { projectName: "dpf-feat-gone", newestContainerCreatedMs: daysAgo(10) },
    { nowMs: NOW, liveWorktreeProjectNames: ["dpf-feat-active"] },
  );
  assert.equal(d.verdict, "REAP");
  assert.match(d.reason, /orphaned worktree compose project/);
});

test("a project with a running container is NEVER reaped, even when ancient (in use now)", () => {
  const d = decideComposeProject(
    { projectName: "dpf-long-lived-devstack", newestContainerCreatedMs: daysAgo(99), hasRunningContainer: true },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /running container/);
});

test("a foreign (non-dpf) project past threshold is REAPED and labeled foreign", () => {
  const d = decideComposeProject(
    { projectName: "some-other-stack", newestContainerCreatedMs: daysAgo(10) },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "REAP");
  assert.match(d.reason, /foreign \(non-dpf\)/);
});

test("a stray project younger than threshold is KEPT (idle is not abandoned)", () => {
  const d = decideComposeProject(
    { projectName: "dpf-feat-gone", newestContainerCreatedMs: daysAgo(2) },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "KEEP");
  assert.match(d.reason, /grace/);
});

test("an empty project name is ignored", () => {
  const d = decideComposeProject(
    { projectName: "", newestContainerCreatedMs: daysAgo(99) },
    { nowMs: NOW, liveWorktreeProjectNames: [] },
  );
  assert.equal(d.verdict, "KEEP");
});

// ── planReap: full pass, no silent truncation ────────────────────────────────

test("planReap reports every decision and the reap subsets (no silent caps)", () => {
  const plan = planReap({
    buildImages: [
      { repository: "dpf-local-integration-a-build", createdMs: daysAgo(10) }, // reap
      { repository: "dpf-local-integration-b-build", createdMs: daysAgo(1) }, // keep (young)
      { repository: "dpf-portal", createdMs: daysAgo(400) }, // keep (not CI)
    ],
    composeProjects: [
      { projectName: "dpf", newestContainerCreatedMs: daysAgo(400) }, // keep (root)
      { projectName: "dpf-feat-active", newestContainerCreatedMs: daysAgo(50) }, // keep (live)
      { projectName: "dpf-feat-gone", newestContainerCreatedMs: daysAgo(10) }, // reap (orphan)
      { projectName: "foreign", newestContainerCreatedMs: daysAgo(10) }, // reap (foreign)
    ],
    liveWorktreeProjectNames: ["dpf-feat-active"],
    nowMs: NOW,
  });

  // Every input is accounted for — nothing dropped.
  assert.equal(plan.imageDecisions.length, 3);
  assert.equal(plan.projectDecisions.length, 4);

  assert.deepEqual(
    plan.imagesToReap.map((d) => d.image.repository),
    ["dpf-local-integration-a-build"],
  );
  assert.deepEqual(
    plan.projectsToReap.map((d) => d.project.projectName).sort(),
    ["dpf-feat-gone", "foreign"],
  );
  assert.equal(plan.stalenessDays, DEFAULT_STALENESS_DAYS);
});

test("planReap tolerates empty/missing inputs", () => {
  const plan = planReap({ nowMs: NOW });
  assert.deepEqual(plan.imageDecisions, []);
  assert.deepEqual(plan.projectDecisions, []);
  assert.deepEqual(plan.imagesToReap, []);
  assert.deepEqual(plan.projectsToReap, []);
});

// ── decideVolumeReclaim ───────────────────────────────────────────────────────

test("reclaims volumes for a stray dpf-<topic> project", () => {
  const r = decideVolumeReclaim("dpf-provider-openrouter-policy");
  assert.equal(r.ok, true);
  assert.match(r.reason, /orphaned and reclaimable/);
});

test("reclaims volumes for a foreign compose project", () => {
  assert.equal(decideVolumeReclaim("some-foreign-project").ok, true);
});

test("NEVER reclaims the root dpf project's volumes (never-wipe-db, case-insensitive)", () => {
  for (const name of [ROOT_COMPOSE_PROJECT, "dpf", "DPF", " Dpf "]) {
    const r = decideVolumeReclaim(name);
    assert.equal(r.ok, false, `expected ${JSON.stringify(name)} refused`);
    assert.match(r.reason, /root dpf project/);
  }
});

test("refuses an empty/nullish project name rather than reclaiming broadly", () => {
  for (const name of ["", "   ", null, undefined]) {
    assert.equal(decideVolumeReclaim(name).ok, false);
  }
});
