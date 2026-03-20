import React, { useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, spacing } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { usePortfolioStore } from "@/src/features/portfolio/portfolio.store";

export default function PortfolioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { selectedPortfolio, isLoading, error, fetchDetail } =
    usePortfolioStore();

  const refresh = useCallback(() => {
    if (id) return fetchDetail(id);
  }, [id, fetchDetail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const products = selectedPortfolio?.products ?? [];

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={products}
      keyExtractor={(item: any) => item.id}
      renderItem={({ item }: { item: any }) => (
        <Card style={styles.productCard}>
          <Text style={styles.productName}>{item.name ?? item.slug ?? item.id}</Text>
        </Card>
      )}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.portfolioName}>
            {selectedPortfolio?.name ?? "Portfolio"}
          </Text>
          {selectedPortfolio?.description ? (
            <Text style={styles.description}>
              {selectedPortfolio.description}
            </Text>
          ) : null}
          {selectedPortfolio?.budgetKUsd != null ? (
            <Text style={styles.budget}>
              Budget: ${selectedPortfolio.budgetKUsd}k
            </Text>
          ) : null}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>Products</Text>
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>No products in this portfolio</Text>
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
  header: {
    padding: spacing.md,
  },
  portfolioName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  budget: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  productCard: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  productName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    padding: spacing.md,
    marginTop: spacing.sm,
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
