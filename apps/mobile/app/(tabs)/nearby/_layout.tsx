import { Stack } from "expo-router";
import { useTheme } from "@/src/lib/theme";

export default function NearbyLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.surface1 },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Right here" }} />
      <Stack.Screen name="[slug]" options={{ title: "Menu" }} />
    </Stack>
  );
}
