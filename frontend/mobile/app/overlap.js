import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { api } from "../lib/api";

function formatSlot(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function OverlapScreen() {
  const [overlaps, setOverlaps] = useState([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setMsg("");
    setLoading(true);
    try {
      const data = await api.getOverlap();
      const list = data.overlaps || [];
      setOverlaps(list);
      if (list.length === 0) {
        setMsg(
          "No overlapping times yet. Both connected users need to submit availability for the same hour."
        );
      } else {
        setMsg(`Found ${list.length} matching time(s).`);
      }
    } catch (e) {
      setOverlaps([]);
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Times you both can call</Text>

      <Pressable
        style={[styles.button, loading && styles.disabled]}
        onPress={load}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Loading..." : "Refresh"}
        </Text>
      </Pressable>

      {overlaps.map((iso) => (
        <View key={iso} style={styles.row}>
          <Text style={styles.rowText}>✓ {formatSlot(iso)}</Text>
        </View>
      ))}

      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  button: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 16,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "white", fontWeight: "600" },
  row: {
    backgroundColor: "#dcfce7",
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  rowText: { fontSize: 16, color: "#14532d" },
  msg: { marginTop: 12, textAlign: "center", color: "#444" },
});
