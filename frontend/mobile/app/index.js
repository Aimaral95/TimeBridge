import { useEffect, useState } from "react";
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
import { saveAuth, getToken } from "../lib/auth";

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(
    Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || "UTC"
  );
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // If we already have a token, skip straight to Home.
  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) router.replace("/home");
    })();
  }, []);

  async function onSubmit() {
    setMsg("");
    setLoading(true);
    try {
      if (mode === "register") {
        if (!name || !email || !password || !timezone) {
          throw new Error("All fields are required");
        }
        await api.register(name, email, password, timezone);
        setMsg("Registered. Logging in...");
      } else {
        if (!email || !password) throw new Error("Email and password required");
      }
      const data = await api.login(email, password);
      await saveAuth(data.token, data.user);
      setMsg("Logged in");
      router.replace("/home");
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>TimeBridge</Text>
      <Text style={styles.subtitle}>
        {mode === "login" ? "Log in" : "Create an account"}
      </Text>

      {mode === "register" && (
        <TextInput
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChangeText={setName}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === "register" && (
        <TextInput
          style={styles.input}
          placeholder="Timezone (e.g. America/New_York)"
          autoCapitalize="none"
          value={timezone}
          onChangeText={setTimezone}
        />
      )}

      <Pressable
        style={[styles.button, loading && styles.disabled]}
        onPress={onSubmit}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "..." : mode === "login" ? "Login" : "Register"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          setMode(mode === "login" ? "register" : "login");
          setMsg("");
        }}
      >
        <Text style={styles.link}>
          {mode === "login"
            ? "No account? Register"
            : "Have an account? Login"}
        </Text>
      </Pressable>

      {mode === "login" && (
        <Pressable onPress={() => router.push("/forgot-password")}>
          <Text style={[styles.link, { color: "#0ea5e9" }]}>
            Forgot password?
          </Text>
        </Pressable>
      )}

      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 40 },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 24,
    color: "#555",
  },
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
    marginTop: 8,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "white", fontWeight: "bold" },
  link: { textAlign: "center", marginTop: 16, color: "#2563eb" },
  msg: { textAlign: "center", marginTop: 16, color: "#444" },
});
