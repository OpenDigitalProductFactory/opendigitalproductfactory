/**
 * Customer-mode home panel: "My visits" — the signed-in customer's
 * appointments. Renders only when the install manifest tells us this is
 * the customer surface. Pairs with CustomerInvoicesPanel; together they
 * cover the customer's recurring needs (pay + visits) on a single screen.
 */
import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/lib/theme";
import {
  partitionVisits,
  useCustomerVisitsStore,
} from "./customer-visits.store";
import type { CustomerVisit } from "@dpf/types";

function VisitRow({ visit }: { visit: CustomerVisit }): React.JSX.Element {
  const { colors, spacing, borderRadius } = useTheme();
  const styles = useMemo(
    () => makeRowStyles({ colors, spacing, borderRadius }),
    [colors, spacing, borderRadius],
  );
  const when = new Date(visit.scheduledAt);
  return (
    <View style={styles.row} testID={`customer-visit-${visit.bookingRef}`}>
      <View style={styles.left}>
        <Text style={styles.title}>{visit.itemName ?? visit.bookingRef}</Text>
        <Text style={styles.meta}>
          {when.toLocaleString()}
          {visit.providerName ? ` · with ${visit.providerName}` : ""}
        </Text>
      </View>
      <Text style={statusStyle(visit.status, colors)}>{visit.status}</Text>
    </View>
  );
}

function statusStyle(
  status: CustomerVisit["status"],
  colors: ReturnType<typeof useTheme>["colors"],
): { color: string; fontSize: number; fontWeight: "700"; textTransform: "uppercase" } {
  const base = { fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const };
  switch (status) {
    case "completed":
      return { ...base, color: colors.success };
    case "cancelled":
    case "no_show":
      return { ...base, color: colors.error };
    default:
      return { ...base, color: colors.primary };
  }
}

export function CustomerVisitsPanel(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const { visits, isLoading, error, fetch } = useCustomerVisitsStore();

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const { upcoming, recent } = useMemo(() => partitionVisits(visits), [visits]);

  return (
    <View style={styles.panel}>
      <Text style={styles.h1}>My visits</Text>
      {error ? (
        <Text style={styles.error} testID="customer-visits-error">
          {error}
        </Text>
      ) : null}
      {isLoading && visits.length === 0 ? (
        <ActivityIndicator
          color={theme.colors.primary}
          testID="customer-visits-loading"
        />
      ) : visits.length === 0 ? (
        <Text style={styles.empty}>No visits yet.</Text>
      ) : (
        <View>
          {upcoming.length > 0 ? (
            <View>
              <Text style={styles.h2}>Upcoming</Text>
              {upcoming.map((vv) => (
                <VisitRow key={vv.id} visit={vv} />
              ))}
            </View>
          ) : null}
          {recent.length > 0 ? (
            <View>
              <Text style={styles.h2}>Recent</Text>
              {recent.map((vv) => (
                <VisitRow key={vv.id} visit={vv} />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function makeStyles({ colors, spacing }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    panel: { padding: spacing.md, gap: spacing.sm },
    h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
    h2: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    empty: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
    error: { color: colors.error, fontSize: 13 },
  });
}

function makeRowStyles({
  colors,
  spacing,
  borderRadius,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  borderRadius: ReturnType<typeof useTheme>["borderRadius"];
}) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginVertical: spacing.xs,
    },
    left: { flex: 1, marginRight: spacing.sm },
    title: { color: colors.text, fontSize: 15, fontWeight: "600" },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });
}
