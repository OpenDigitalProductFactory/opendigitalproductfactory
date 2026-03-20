import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  Switch,
  StyleSheet,
} from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

export function SelectField({ definition, value, onChange, error }: FieldProps) {
  const isToggle =
    definition.type === "checkbox" || definition.type === "toggle";

  if (isToggle) {
    return (
      <View style={styles.container}>
        <View style={styles.toggleRow}>
          <Text style={styles.label}>{definition.label}</Text>
          <Switch
            value={Boolean(value)}
            onValueChange={(val) => onChange(val)}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.white}
            accessibilityLabel={definition.label}
            testID={`field-${definition.key}`}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return <SelectPicker definition={definition} value={value} onChange={onChange} error={error} />;
}

function SelectPicker({ definition, value, onChange, error }: FieldProps) {
  const [open, setOpen] = useState(false);
  const options = definition.options ?? [];
  const displayValue = value != null ? String(value) : "";

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
        <Text
          style={[
            styles.pickerText,
            !displayValue && styles.placeholder,
          ]}
        >
          {displayValue || `Select ${definition.label.toLowerCase()}`}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{definition.label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.option,
                    item === value && styles.optionSelected,
                  ]}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  testID={`option-${item}`}
                >
                  <Text
                    style={[
                      styles.optionText,
                      item === value && styles.optionTextSelected,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  picker: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  pickerError: {
    borderColor: colors.error,
  },
  pickerText: {
    color: colors.text,
    fontSize: 16,
  },
  placeholder: {
    color: colors.textMuted,
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
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  optionSelected: {
    backgroundColor: colors.primary + "22",
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
