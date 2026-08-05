/**
 * Connect to a business — entry point for adding a new space to the
 * generic mobile app. Takes the user's organization URL, validates it
 * against the `.well-known/dpf-instance.json` descriptor, registers it
 * in the spaces store, then hands off to /login for credentials against
 * the just-connected install.
 *
 * Same form whether this is the first business you join (replaces the
 * silent default) or the third — the only difference is the spaces store
 * accumulates rather than overwrites.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import {
  resolveInstall,
  setServerUrl,
} from "@/src/lib/serverConfig";
import { useSpacesStore } from "@/src/stores/spaces";

export default function ConnectScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const addSpace = useSpacesStore((s) => s.addSpace);
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const onConnect = async (): Promise<void> => {
    if (!url.trim()) {
      setError("Enter your organization's URL");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Resilient resolve: a reachable install with no (or a not-yet-served)
      // discovery descriptor still connects — we synthesize a minimal one and
      // proceed to sign-in rather than dying on a /welcome HTML redirect.
      const { descriptor } = await resolveInstall(url.trim());
      const persisted = await setServerUrl(url.trim());
      addSpace({ url: persisted, descriptor });
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.surface1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles(theme).inner}>
        <Text style={styles(theme).title}>Connect a business</Text>
        <Text style={styles(theme).subtitle}>
          Enter the URL of your organization's DPF install. You'll sign in next.
        </Text>

        {error ? <Text style={styles(theme).error}>{error}</Text> : null}

        <TextInput
          value={url}
          onChangeText={setUrl}
          style={styles(theme).input}
          placeholder="https://acme.example"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!submitting}
          testID="connect-url"
        />

        <Pressable
          style={[styles(theme).button, submitting && styles(theme).disabled]}
          onPress={onConnect}
          disabled={submitting}
          accessibilityRole="button"
          testID="connect-submit"
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.white} />
          ) : (
            <Text style={styles(theme).buttonText}>Connect</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    inner: { padding: t.spacing.lg, flex: 1, justifyContent: "center" },
    title: { color: t.colors.text, fontSize: 24, fontWeight: "700" },
    subtitle: {
      color: t.colors.textMuted,
      fontSize: 14,
      marginTop: t.spacing.xs,
      marginBottom: t.spacing.lg,
    },
    error: { color: t.colors.error, marginBottom: t.spacing.sm },
    input: {
      backgroundColor: t.colors.surface2,
      color: t.colors.text,
      borderColor: t.colors.border,
      borderWidth: 1,
      borderRadius: t.borderRadius.md,
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm + 2,
      fontSize: 16,
    },
    button: {
      marginTop: t.spacing.md,
      backgroundColor: t.colors.primary,
      borderRadius: t.borderRadius.md,
      paddingVertical: t.spacing.sm + 4,
      alignItems: "center",
    },
    disabled: { opacity: 0.6 },
    buttonText: { color: t.colors.white, fontSize: 16, fontWeight: "600" },
  });
