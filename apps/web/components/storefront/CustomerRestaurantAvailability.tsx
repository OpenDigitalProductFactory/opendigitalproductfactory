import type { CustomerRestaurantAvailability as CustomerAvailability } from "@/lib/twin/restaurant-floor-projection";

const PUBLIC_TABLE_DETAIL_LIMIT = 12;

function availableNowLabel(count: number): string {
  return `${count} table${count === 1 ? "" : "s"} available now`;
}

/**
 * Public, read-only restaurant capacity summary.
 *
 * Render only the explicit public DTO. Do not accept the operator projection:
 * this component is the final presentation boundary protecting party, staffing,
 * and persisted table identity from public serialization.
 */
export function CustomerRestaurantAvailability({
  availability,
}: {
  availability: CustomerAvailability;
}) {
  const visibleTables = availability.tables.slice(
    0,
    PUBLIC_TABLE_DETAIL_LIMIT,
  );
  const detailsAreBounded =
    availability.tables.length > PUBLIC_TABLE_DETAIL_LIMIT;

  return (
    <section
      aria-labelledby="customer-table-availability"
      style={{
        marginBottom: 20,
        padding: "16px",
        borderRadius: 10,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2
          id="customer-table-availability"
          style={{
            margin: 0,
            color: "var(--dpf-text)",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Table availability
        </h2>
        <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>
          Live estimate
        </span>
      </div>

      <p
        style={{
          color: "var(--dpf-text)",
          fontSize: 14,
          lineHeight: 1.5,
          margin: "8px 0 12px",
        }}
      >
        {availableNowLabel(availability.summary.availableNow)}
        {availability.summary.availableSoon > 0
          ? ` · ${availability.summary.availableSoon} expected soon`
          : ""}
      </p>

      <ul
        style={{
          display: "grid",
          gap: 8,
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {visibleTables.map((table) => (
          <li
            key={table.key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--dpf-surface-2)",
              color: "var(--dpf-text)",
              fontSize: 13,
            }}
          >
            <span>
              <strong>Seats up to {table.capacity}</strong>
              {table.serviceArea ? ` · ${table.serviceArea}` : ""}
            </span>
            <span style={{ color: "var(--dpf-muted)", textAlign: "right" }}>
              {table.availability.explanation}
            </span>
          </li>
        ))}
      </ul>

      {detailsAreBounded ? (
        <p
          style={{
            color: "var(--dpf-muted)",
            fontSize: 12,
            lineHeight: 1.5,
            margin: "10px 0 0",
          }}
        >
          {visibleTables.length} of {availability.tables.length} table options
          shown. All available tables are considered when you choose a time.
        </p>
      ) : null}

      <p
        style={{
          color: "var(--dpf-muted)",
          fontSize: 12,
          lineHeight: 1.5,
          margin: "12px 0 0",
        }}
      >
        Estimates can change while you choose a time. Your table is confirmed
        during booking.
      </p>
    </section>
  );
}
