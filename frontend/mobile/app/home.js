import { useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "../lib/api";
import { getUser, clearAuth } from "../lib/auth";

const DAY_KEYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function toMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function activeBlock(blocks) {
  if (!blocks || !blocks.length) return null;
  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const mins = now.getHours() * 60 + now.getMinutes();
  return blocks.find(b =>
    Array.isArray(b.days) &&
    b.days.includes(dayKey) &&
    toMin(b.start_time) <= mins &&
    mins < toMin(b.end_time)
  ) || null;
}

// Use the block's saved color when present; fall back to a small palette for legacy
// blocks that were saved before the color column existed.
function statusFromBlock(b) {
  if (!b) return { label: "Free", emoji: "✅", color: "#16a34a" };
  const isHex = typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color);
  const legacy = { class: "#2563eb", work: "#f97316", gym: "#7c3aed", other: "#dc2626" };
  const color = isHex ? b.color : (legacy[b.type] || "#dc2626");
  // Show the user's own type label (custom free text) instead of hardcoded categories.
  const label = b.type ? `Busy · ${b.type}` : "Busy";
  return { label, emoji: "🔴", color };
}

export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [connections, setConnections] = useState([]);
  const [scheduleBlocks, setScheduleBlocks] = useState([]);
  const [msg, setMsg] = useState("");

  // Re-load on focus (works after returning from other screens).
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const u = await getUser();
        setUser(u);
        try {
          const data = await api.getConnections();
          setConnections(data.connections || []);
        } catch (e) {
          setMsg(e.message);
        }
        try {
          const s = await api.getSchedule();
          setScheduleBlocks(s.blocks || []);
        } catch (_) { /* schedule is optional */ }
      })();
    }, [])
  );

  const current = useMemo(() => activeBlock(scheduleBlocks), [scheduleBlocks]);
  const status = useMemo(() => statusFromBlock(current), [current]);

  async function createInvite() {
    setMsg("");
    try {
      const data = await api.createInvite();
      setInviteCode(data.connection.invite_code);
      setMsg("Invite created. Share the code below.");
      const c = await api.getConnections();
      setConnections(c.connections || []);
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function joinInvite() {
    setMsg("");
    try {
      if (!joinCode.trim()) throw new Error("Enter an invite code");
      const data = await api.joinInvite(joinCode.trim().toUpperCase());
      setMsg(data.message || "Connected");
      setJoinCode("");
      const c = await api.getConnections();
      setConnections(c.connections || []);
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function logout() {
    await clearAuth();
    router.replace("/");
  }

  const accepted = connections.filter((c) => c.status === "accepted");
  const myPending = connections.filter(
    (c) => c.status === "pending" && c.user_id === user?.id
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Hi, {user?.name || "..."}</Text>
      <Text style={styles.sub}>Timezone: {user?.timezone}</Text>

      {/* Auto status from schedule */}
      <View style={[styles.statusCard, { borderColor: status.color }]}>
        <Text style={[styles.statusBig, { color: status.color }]}>
          {status.emoji}  Right now: {status.label}
        </Text>
        {current ? (
          <Text style={styles.statusSub}>
            {current.title} · {current.start_time}–{current.end_time}
          </Text>
        ) : (
          <Text style={styles.statusSub}>
            No schedule block active. You're available for calls.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Create Invite Code</Text>
        <Pressable style={styles.button} onPress={createInvite}>
          <Text style={styles.buttonText}>Create Invite Code</Text>
        </Pressable>
        {!!inviteCode && (
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{inviteCode}</Text>
            <Text style={styles.codeHint}>
              Share this code with the other person.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Join with Invite Code</Text>
        <TextInput
          style={styles.input}
          placeholder="ENTER CODE"
          autoCapitalize="characters"
          value={joinCode}
          onChangeText={setJoinCode}
        />
        <Pressable style={styles.button} onPress={joinInvite}>
          <Text style={styles.buttonText}>Join</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Your connections</Text>
        <Text style={styles.line}>Accepted: {accepted.length}</Text>
        <Text style={styles.line}>
          Pending invites you created: {myPending.length}
        </Text>
        {myPending.map((p) => (
          <Text key={p.id} style={styles.codeMini}>
            ↳ {p.invite_code}
          </Text>
        ))}
      </View>

      <Pressable
        style={[styles.button, styles.green]}
        onPress={() => router.push("/availability")}
      >
        <Text style={styles.buttonText}>Set My Availability</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.purple]}
        onPress={() => router.push("/overlap")}
      >
        <Text style={styles.buttonText}>See Overlap</Text>
      </Pressable>

      <Pressable style={[styles.button, styles.gray]} onPress={logout}>
        <Text style={styles.buttonText}>Logout</Text>
      </Pressable>

      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 26, fontWeight: "bold" },
  sub: { color: "#666", marginBottom: 16 },
  h2: { fontSize: 18, fontWeight: "600", marginBottom: 8 },

  statusCard: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  statusBig: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  statusSub: { color: "#555" },

  card: {
    backgroundColor: "#f3f4f6",
    padding: 14,
    borderRadius: 8,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
    backgroundColor: "white",
    letterSpacing: 2,
  },
  button: {
    backgroundColor: "#2563eb",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginVertical: 6,
  },
  buttonText: { color: "white", fontWeight: "600" },
  green: { backgroundColor: "#16a34a" },
  purple: { backgroundColor: "#7c3aed" },
  gray: { backgroundColor: "#6b7280" },
  codeBox: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  codeText: { fontSize: 24, fontWeight: "bold", letterSpacing: 4 },
  codeHint: { color: "#666", marginTop: 4, fontSize: 12 },
  codeMini: { fontFamily: "monospace", marginTop: 4, color: "#444" },
  line: { color: "#333", marginBottom: 2 },
  msg: { marginTop: 12, textAlign: "center", color: "#444" },
});
