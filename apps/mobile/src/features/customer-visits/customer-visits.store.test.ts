import {
  partitionVisits,
  useCustomerVisitsStore,
} from "./customer-visits.store";
import type { CustomerVisit } from "@dpf/types";

const mockMyVisits = jest.fn();
jest.mock("@/src/lib/apiClient", () => ({
  api: { customer: { myVisits: (...a: unknown[]) => mockMyVisits(...a) } },
}));

const v = (
  id: string,
  scheduledAt: string,
  status: CustomerVisit["status"] = "confirmed",
): CustomerVisit => ({
  id,
  bookingRef: `BK-${id}`,
  scheduledAt,
  durationMinutes: 60,
  status,
  itemName: "Service",
  providerName: null,
  notes: null,
  cancellationReason: null,
  createdAt: scheduledAt,
});

function resetStore() {
  useCustomerVisitsStore.getState().reset();
  mockMyVisits.mockReset();
}

describe("useCustomerVisitsStore.fetch", () => {
  beforeEach(resetStore);

  it("populates the list from the API on success and clears prior error", async () => {
    useCustomerVisitsStore.setState({ error: "stale" });
    mockMyVisits.mockResolvedValueOnce({
      data: [v("1", "2026-07-10T10:00:00.000Z")],
      nextCursor: null,
    });
    await useCustomerVisitsStore.getState().fetch();
    expect(useCustomerVisitsStore.getState().visits).toHaveLength(1);
    expect(useCustomerVisitsStore.getState().error).toBeNull();
  });

  it("forwards the upcoming + status filters", async () => {
    mockMyVisits.mockResolvedValueOnce({ data: [], nextCursor: null });
    await useCustomerVisitsStore
      .getState()
      .fetch({ upcoming: true, status: "confirmed" });
    expect(mockMyVisits.mock.calls[0][0]).toEqual({
      limit: 25,
      upcoming: true,
      status: "confirmed",
    });
  });

  it("surfaces API errors without dropping the existing list", async () => {
    useCustomerVisitsStore.setState({
      visits: [v("seed", "2026-07-10T10:00:00.000Z")],
    });
    mockMyVisits.mockRejectedValueOnce(new Error("HTTP 500"));
    await useCustomerVisitsStore.getState().fetch();
    const s = useCustomerVisitsStore.getState();
    expect(s.error).toContain("500");
    expect(s.visits).toHaveLength(1);
  });
});

describe("partitionVisits", () => {
  const NOW = new Date("2026-06-18T12:00:00.000Z");

  it("splits future visits into upcoming and past into recent", () => {
    const out = partitionVisits(
      [
        v("past", "2026-06-10T09:00:00.000Z"),
        v("future", "2026-07-10T09:00:00.000Z"),
      ],
      NOW,
    );
    expect(out.upcoming.map((x) => x.id)).toEqual(["future"]);
    expect(out.recent.map((x) => x.id)).toEqual(["past"]);
  });

  it("treats cancelled/no_show as recent even when scheduled in the future", () => {
    const out = partitionVisits(
      [
        v("a", "2026-07-10T09:00:00.000Z", "cancelled"),
        v("b", "2026-07-10T09:00:00.000Z", "no_show"),
        v("c", "2026-07-10T09:00:00.000Z", "confirmed"),
      ],
      NOW,
    );
    expect(out.upcoming.map((x) => x.id)).toEqual(["c"]);
    expect(out.recent.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("orders upcoming soonest-first, recent most-recent-first", () => {
    const out = partitionVisits(
      [
        v("u_later", "2026-08-10T09:00:00.000Z"),
        v("u_soon", "2026-06-19T09:00:00.000Z"),
        v("r_old", "2026-05-01T09:00:00.000Z"),
        v("r_recent", "2026-06-10T09:00:00.000Z"),
      ],
      NOW,
    );
    expect(out.upcoming.map((x) => x.id)).toEqual(["u_soon", "u_later"]);
    expect(out.recent.map((x) => x.id)).toEqual(["r_recent", "r_old"]);
  });

  it("drops entries with an unparseable scheduledAt rather than throwing", () => {
    const out = partitionVisits(
      [v("good", "2026-07-10T09:00:00.000Z"), v("bad", "not-a-date")],
      NOW,
    );
    expect(out.upcoming.length + out.recent.length).toBe(1);
  });
});
