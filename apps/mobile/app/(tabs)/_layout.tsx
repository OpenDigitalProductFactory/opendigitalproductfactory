import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AppPersona } from "@dpf/types";
import { useTheme } from "@/src/lib/theme";
import { useAppConfigStore } from "@/src/lib/appConfig";
import { useAuthStore } from "@/src/features/auth/auth.store";
import { resolveDefaultTab, resolveVisibleTabs } from "@/src/lib/navigation";

export default function TabsLayout() {
  const { colors } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const manifestPersona = useAppConfigStore((s) => s.persona);
  const capabilities = useAppConfigStore((s) => s.capabilities);
  const navigation = useAppConfigStore((s) => s.navigation);

  // An unauthenticated open is a walk-up visitor: force the visitor persona so
  // the tab bar shows only the anonymous Nearby front door, even before any
  // install manifest has loaded. Signed-in users keep the manifest persona.
  const persona: AppPersona | null = isAuthenticated
    ? manifestPersona
    : { kind: "visitor" };

  // Which tabs the connected install exposes for this persona. With no manifest
  // loaded this returns the full operator set, so the default app is unchanged.
  const visibleTabs = resolveVisibleTabs({
    persona,
    capabilities,
    manifestTabs: navigation?.tabs,
  });
  const visible = new Set(visibleTabs);
  // `href: null` hides a tab from the bar; `undefined` leaves it visible.
  const hiddenHref = (name: string): null | undefined =>
    visible.has(name) ? undefined : null;
  // Landing tab: a field tech lands on Jobs, customer/operator land on Home.
  const initialRouteName = resolveDefaultTab({
    manifestDefault: navigation?.defaultTab,
    visibleTabs,
  });

  return (
    <Tabs
      initialRouteName={initialRouteName}
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface1,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          href: hiddenHref("index"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: "Nearby",
          headerShown: false,
          href: hiddenHref("nearby"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="location" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ops"
        options={{
          title: "Ops",
          headerShown: false,
          href: hiddenHref("ops"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: "Jobs",
          headerShown: false,
          href: hiddenHref("jobs"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portfolio",
          headerShown: false,
          href: hiddenHref("portfolio"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pie-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="mileage"
        options={{
          title: "Mileage",
          href: hiddenHref("mileage"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="car" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: "Customers",
          headerShown: false,
          href: hiddenHref("customers"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          headerShown: false,
          href: hiddenHref("more"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
