import { View, Text, StyleSheet } from "react-native";

export default function PortfolioScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Portfolio</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1e1e2e" },
  text: { color: "#e2e8f0", fontSize: 18 },
});
