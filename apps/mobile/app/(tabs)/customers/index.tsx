import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  View,
} from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { CustomerCard } from "@/src/components/CustomerCard";
import { useCustomerStore } from "@/src/features/customer/customer.store";
import type { CustomerAccount } from "@dpf/types";

export default function CustomersScreen() {
  const { customers, isLoading, error, fetchCustomers } = useCustomerStore();
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(
    (query?: string) => {
      return fetchCustomers(query || undefined);
    },
    [fetchCustomers],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearch(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        refresh(text);
      }, 300);
    },
    [refresh],
  );

  return (
    <FlatList<CustomerAccount>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={customers}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <CustomerCard customer={item} />}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={() => refresh(search)}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        <View>
          <Text style={styles.heading}>Customers</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Search customers..."
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search customers"
          />
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>No customers found</Text>
        ) : (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.loader}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 15,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
