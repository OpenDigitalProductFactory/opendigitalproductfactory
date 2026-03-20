import { View, Text, StyleSheet } from "react-native";

interface OfflineBannerProps {
  isOnline: boolean;
}

export function OfflineBanner({ isOnline }: OfflineBannerProps) {
  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        You are offline. Some features may be unavailable.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#eab308",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    textAlign: "center",
    color: "#1e1e2e",
    fontSize: 14,
    fontWeight: "500",
  },
});
