import { describe, expect, it } from "vitest";
import { resolveRoomFunding, type FundingRoom } from "./investment-balance-binding";

const founder = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" as const };
const org = { principalId: "p2", organizationId: "org1", purpose: "archetype" as const };
const binding = (scope = founder) => ({ investmentBalanceV1: { bindings: { "*": { version: 1, scope } } } });
const read = (rooms: Record<string, FundingRoom>) => async (id: string) => rooms[id] ?? null;

describe("funding through shared workrooms", () => {
  it("refuses conflicting item classifications at equal precedence", async () => {
    const classified = (value: string) => ({ investmentBalanceV1: { bindings: { item1: { version: 1, scope: founder, classification: value, boundAt: "2026-10-13T00:00:00Z" } } } });
    const rooms = { child: { id: "child", promotionPolicy: {}, parentIds: ["a", "b"] }, a: { id: "a", promotionPolicy: classified("refactor"), parentIds: [] }, b: { id: "b", promotionPolicy: classified("new"), parentIds: [] } };
    expect(await resolveRoomFunding("child", "item1", read(rooms))).toMatchObject({ ok: false, error: "conflicting-funding" });
  });
  it("inherits a recorded funding scope without using execution coordinator identity", async () => {
    const rooms = { child: { id: "child", promotionPolicy: {}, parentIds: ["parent"] }, parent: { id: "parent", promotionPolicy: binding(), parentIds: [] } };
    expect(await resolveRoomFunding("child", "item1", read(rooms))).toMatchObject({ ok: true, data: { scope: founder, sourceRoomId: "parent" } });
  });
  it("resolves each funded item separately in a common room", async () => {
    const rooms = { room: { id: "room", promotionPolicy: { investmentBalanceV1: { bindings: { a: { version: 1, scope: founder }, b: { version: 1, scope: org } } } }, parentIds: [] } };
    expect(await resolveRoomFunding("room", "a", read(rooms))).toMatchObject({ ok: true, data: { scope: founder } });
    expect(await resolveRoomFunding("room", "b", read(rooms))).toMatchObject({ ok: true, data: { scope: org } });
    expect(await resolveRoomFunding("room", "c", read(rooms))).toEqual({ ok: true, data: null });
  });
  it("rejects equally close conflicting funding owners", async () => {
    const rooms = { child: { id: "child", promotionPolicy: {}, parentIds: ["a", "b"] }, a: { id: "a", promotionPolicy: binding(), parentIds: [] }, b: { id: "b", promotionPolicy: binding(org as never), parentIds: [] } };
    expect(await resolveRoomFunding("child", "item1", read(rooms))).toMatchObject({ ok: false, error: "conflicting-funding" });
  });
  it("rejects cycles rather than quietly falling back to installation defaults", async () => {
    const rooms = { a: { id: "a", promotionPolicy: {}, parentIds: ["b"] }, b: { id: "b", promotionPolicy: {}, parentIds: ["a"] } };
    expect(await resolveRoomFunding("a", "item1", read(rooms))).toMatchObject({ ok: false, error: "funding-cycle" });
  });
  it("allows a diamond with one common owner", async () => {
    const rooms = { child: { id: "child", promotionPolicy: {}, parentIds: ["a", "b"] }, a: { id: "a", promotionPolicy: {}, parentIds: ["root"] }, b: { id: "b", promotionPolicy: {}, parentIds: ["root"] }, root: { id: "root", promotionPolicy: binding(), parentIds: [] } };
    expect(await resolveRoomFunding("child", "item1", read(rooms))).toMatchObject({ ok: true, data: { scope: founder } });
  });
  it("rejects malformed explicit binding without inheriting another owner's defaults", async () => {
    expect(await resolveRoomFunding("room", "item1", read({ room: { id: "room", promotionPolicy: { investmentBalanceV1: { bindings: { "*": { version: 999, scope: founder } } } }, parentIds: [] } }))).toMatchObject({ ok: false, error: "malformed-funding" });
  });
  it("bounds parent traversal", async () => {
    const rooms = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), { id: String(i), promotionPolicy: {}, parentIds: [String(i + 1)] }]));
    expect(await resolveRoomFunding("0", "item1", read(rooms))).toMatchObject({ ok: false, error: "funding-depth" });
  });
  it("rejects funding copied from another installation", async () => {
    const rooms = { room: { id: "room", promotionPolicy: binding(), parentIds: [] } };
    expect(await resolveRoomFunding("room", "item1", read(rooms), "local-install")).toMatchObject({ ok: false, error: "funding-installation-mismatch" });
  });
});
