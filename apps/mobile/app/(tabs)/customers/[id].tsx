import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useCustomerStore } from "@/src/features/customer/customer.store";

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    selectedCustomer,
    isLoading,
    error,
    fetchDetail,
    updateCustomer,
  } = useCustomerStore();

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const refresh = useCallback(() => {
    if (id) return fetchDetail(id);
  }, [id, fetchDetail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Populate form fields when customer loads
  useEffect(() => {
    if (selectedCustomer) {
      setName(selectedCustomer.name ?? "");
      setIndustry((selectedCustomer as any).industry ?? "");
      setNotes((selectedCustomer as any).notes ?? "");
      setHasChanges(false);
    }
  }, [selectedCustomer]);

  const handleFieldChange = (
    setter: (v: string) => void,
    value: string,
  ) => {
    setter(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!id) return;
    await updateCustomer(id, {
      name: name.trim() || undefined,
      industry: industry.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    if (!useCustomerStore.getState().error) {
      setHasChanges(false);
    }
  };

  const contacts = selectedCustomer?.contacts ?? [];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <Text style={styles.customerName}>
          {selectedCustomer?.name ?? "Customer"}
        </Text>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Input
            label="Name"
            value={name}
            onChangeText={(v) => handleFieldChange(setName, v)}
            placeholder="Customer name"
          />
          <Input
            label="Industry"
            value={industry}
            onChangeText={(v) => handleFieldChange(setIndustry, v)}
            placeholder="Industry"
          />
          <Input
            label="Notes"
            value={notes}
            onChangeText={(v) => handleFieldChange(setNotes, v)}
            placeholder="Additional notes"
          />

          {hasChanges ? (
            <Button
              title="Save Changes"
              onPress={handleSave}
              loading={isLoading}
            />
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Contacts</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>No contacts</Text>
        ) : (
          contacts.map((contact: any) => (
            <Card key={contact.id} style={styles.contactCard}>
              <Text style={styles.contactName}>
                {contact.name ?? "Unnamed"}
              </Text>
              {contact.email ? (
                <Text style={styles.contactEmail}>{contact.email}</Text>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  customerName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
  form: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  contactCard: {
    marginBottom: spacing.sm,
  },
  contactName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  contactEmail: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
