import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { api } from "../lib/api";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setMsg("");
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Enter your email");
      const r = await api.forgotPassword(email.trim());
      setMsg(r.message || "If that email exists, a reset link was sent.");
      setSent(true);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  function continueWithToken() {
    if (!token.trim()) {
      setMsg("Paste the token from the email link first.");
      return;
    }
    router.push({ pathname: "/reset-password", params: { token: token.trim() } });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Forgot password</Text>
      <Text style={styles.sub}>
        Enter the email you signed up with. We'll send you a link to reset your
        password.
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        editable={!sent}
      />

      {!sent ? (
        <Pressable
          style={[styles.button, loading && styles.disabled]}
          onPress={submit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Sending..." : "Send reset link"}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Text style={styles.h2}>Got the email?</Text>
          <Text style={styles.sub}>
            The link looks like: APP_URL/reset-password/<Text style={styles.mono}>TOKEN</Text>.
            On a phone you can also paste just the token below to continue.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Paste reset token"
            autoCapitalize="none"
            value={token}
            onChangeText={setToken}
          />
          <Pressable style={styles.button} onPress={continueWithToken}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      )}

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
  label: { fontWeight: "600", marginBottom: 6 },
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
  card: {
    backgroundColor: "#f3f4f6",
    padding: 14,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  h2: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  mono: { fontFamily: "monospace" },
});
