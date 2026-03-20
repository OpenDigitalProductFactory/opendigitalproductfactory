import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

export function MultiSelectField({
  definition,
  value,
  onChange,
  error,
}: FieldProps) {
  const [open, setOpen] = useState(false);
  const options = definition.options ?? [];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggleOption(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <Pressable
        style={[styles.picker, error ? styles.pickerError : null]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Select ${definition.label}`}
        testID={`field-${definition.key}`}
      >
        {selected.length > 0 ? (
          <View style={styles.chipRow}>
            {selected.map((item) => (
              <View key={item} style={styles.chip}>
                <Text style={styles.chipText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.placeholder}>
            Select {definition.label.toLowerCase()}
          </Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{definition.label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const isSelected = selected.includes(item);
                return (
                  <Pressable
                    style={[
                      styles.option,
                      isSelected && styles.optionSelected,
                    ]}
                    onPress={() => toggleOption(item)}
                    testID={`option-${item}`}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        isSelected && styles.checkboxChecked,
                      ]}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              }}
            />
            <Pressable
              style={styles.doneButton}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: spacing.xs,
  },
  picker: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: "center",
  },
  pickerError: {
    borderColor: colors.error,
  },
  placeholder: {
    color: colors.textMuted,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.primary + "22",
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chipText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "500",
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: colors.surface2,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.md,
    maxHeight: "60%",
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  optionSelected: {
    backgroundColor: colors.primary + "22",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: "600",
  },
  doneButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  doneText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
