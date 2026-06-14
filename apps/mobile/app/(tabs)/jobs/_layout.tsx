import { Stack } from "expo-router";
import { useTheme } from "@/src/lib/theme";

export default function JobsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.surface1 },
      }}
    >
      <Stack.Screen name="index" options={{ title: "My Jobs" }} />
      <Stack.Screen name="[itemId]" options={{ title: "Job" }} />
    </Stack>
  );
}
