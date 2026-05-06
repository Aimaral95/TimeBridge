import { useState } from "react";
import {
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../lib/api";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialToken = typeof params.token === "string" ? params.token : "";
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setMsg("");
    if (!token.trim()) { setMsg("Reset token is required."); return; }
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setMsg("Passwords do not match."); return; }
    setLoading(true);
    try {
      await api.resetPassword(token.trim(), password);
      setMsg("✅ Password updated. Redirecting to login…");
      setTimeout(() => router.replace("/"), 1400);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Set a new password</Text>
      <Text style={styles.sub}>
        Pick something at least 6 characters. After saving, your old password
        will stop working.
      </Text>

      <Text style={styles.label}>Reset token</Text>
      <TextInput
        style={styles.input}
        placeholder="From the email link"
        autoCapitalize="none"
        value={token}
        onChangeText={setToken}
      />

      <Text style={styles.label}>New password</Text>
      <TextInput
        style={styles.input}
        placeholder="At least 6 characters"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Text style={styles.label}>Confirm password</Text>
      <TextInput
        style={styles.input}
        placeholder="Type it again"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />

      <Pressable
        style={[styles.button, loading && styles.disabled]}
        onPress={submit}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Saving..." : "Save new password"}
        </Text>
      </Pressable>

      <Pressable onPress={() => router.replace("/")}>
        <Text style={styles.link}>← Back to login</Text>
      </Pressable>

      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 6 },
  sub: { color: "#555", marginBottom: 16 },
  label: { fontWeight: "600", marginBottom: 6, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 12,
    borderRadius: 6,
    marginBottom: 12,
    backgroundColor: "white",
  },
  button: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 4,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "white", fontWeight: "bold" },
  link: { textAlign: "center", marginTop: 16, color: "#2563eb" },
  msg: { textAlign: "center", marginTop: 16, color: "#444" },
});
