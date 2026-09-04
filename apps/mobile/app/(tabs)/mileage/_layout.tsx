import { Stack } from "expo-router";
import { useTheme } from "@/src/lib/theme";

export default function MileageLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Mileage" }} />
    </Stack>
  );
}
