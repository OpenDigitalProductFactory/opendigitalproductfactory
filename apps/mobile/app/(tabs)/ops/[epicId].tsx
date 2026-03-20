import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import type { BadgeStatus } from "@/src/components/ui/StatusBadge";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { BacklogItemCard } from "@/src/components/BacklogItemCard";
import { useOpsStore } from "@/src/features/ops/ops.store";
import type { BacklogItem, CreateBacklogItemRequest } from "@dpf/types";

type ItemType = "product" | "portfolio";
const ITEM_TYPES: ItemType[] = ["product", "portfolio"];

function CreateItemModal({
  visible,
  onClose,
  epicId,
}: {
  visible: boolean;
  onClose: () => void;
  epicId: string;
}) {
  const { createItem, isLoading, error } = useOpsStore();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<ItemType>("product");
  const [priority, setPriority] = useState("");

  const handleSubmit = async () => {
    const input: CreateBacklogItemRequest = {
      title: title.trim(),
      body: body.trim() || undefined,
      type,
      epicId,
      priority: priority ? parseInt(priority, 10) : undefined,
    };
    await createItem(input);
    if (!useOpsStore.getState().error) {
      setTitle("");
      setBody("");
      setType("product");
      setPriority("");
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Backlog Item</Text>
            <Button title="Cancel" onPress={onClose} variant="ghost" />
          </View>
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Item title"
          />
          <Input
            label="Description"
            value={body}
            onChangeText={setBody}
            placeholder="Optional description"
          />
          <View style={styles.typeSelector}>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeRow}>
              {ITEM_TYPES.map((t) => (
                <Button
                  key={t}
                  title={t.charAt(0).toUpperCase() + t.slice(1)}
                  onPress={() => setType(t)}
                  variant={type === t ? "primary" : "secondary"}
                />
              ))}
            </View>
          </View>
          <Input
            label="Priority (0-999)"
            value={priority}
            onChangeText={setPriority}
            placeholder="e.g. 100"
          />
          <Button
            title="Create"
            onPress={handleSubmit}
            loading={isLoading}
            disabled={!title.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function EpicDetailScreen() {
  const { epicId } = useLocalSearchParams<{ epicId: string }>();
  const {
    selectedEpic,
    backlogItems,
    isLoading,
    error,
    fetchEpicDetail,
  } = useOpsStore();
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(() => {
    if (epicId) return fetchEpicDetail(epicId);
  }, [epicId, fetchEpicDetail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const status = (selectedEpic?.status ?? "open") as BadgeStatus;

  const handleItemPress = (_item: BacklogItem) => {
    // Future: navigate to backlog item detail or open edit modal
  };

  return (
    <View style={styles.screen}>
      <FlatList<BacklogItem>
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={backlogItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <BacklogItemCard item={item} onPress={handleItemPress} />
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
            <Text style={styles.epicTitle}>
              {selectedEpic?.title ?? "Epic"}
            </Text>
            <StatusBadge status={status} />
            {selectedEpic?.description ? (
              <Text style={styles.description}>
                {selectedEpic.description}
              </Text>
            ) : null}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>Backlog Items</Text>
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.emptyText}>No backlog items</Text>
          ) : (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              style={styles.loader}
            />
          )
        }
      />
      <View style={styles.fab}>
        <Button title="+ New Item" onPress={() => setShowCreate(true)} />
      </View>
      <CreateItemModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        epicId={epicId ?? ""}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    paddingBottom: 80, // space for FAB
  },
  header: {
    padding: spacing.md,
  },
  epicTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
  fab: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.lg,
    left: spacing.lg,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  modalContent: {
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  formError: {
    color: colors.error,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  typeSelector: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: spacing.xs,
  },
  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
});
