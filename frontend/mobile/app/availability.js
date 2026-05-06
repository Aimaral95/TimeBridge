import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { api } from "../lib/api";

// Hours shown in the day grid (8am – 9pm local time).
const HOURS = [];
for (let h = 8; h <= 21; h++) HOURS.push(h);

function makeDays(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

function dateLabel(d) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function hourLabel(h) {
  const period = h < 12 ? "AM" : "PM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${period}`;
}

// Build an ISO timestamp for (date, hour) in the user's local timezone.
function slotIso(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// "HH:MM" → minutes since midnight.
function toMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Does any schedule block cover (date, hour)?
// Backend stores days as string codes ['Mon','Tue',...].
// JS Date.getDay() is Sun=0..Sat=6.
const DAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function inScheduleBlock(date, hour, blocks) {
  const dow = DAY_CODES[date.getDay()];
  const slotStart = hour * 60;
  const slotEnd = slotStart + 60;
  for (const b of blocks) {
    if (!Array.isArray(b.days) || !b.days.includes(dow)) continue;
    const bs = toMin(b.start_time);
    const be = toMin(b.end_time);
    if (bs < slotEnd && be > slotStart) return true;
  }
  return false;
}

export default function AvailabilityScreen() {
  const router = useRouter();
  const days = useMemo(() => makeDays(7), []);
  const [selectedDay, setSelectedDay] = useState(days[0]);
  const [selected, setSelected] = useState(new Set());
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Schedule blocks (recurring weekly busy times).
  const [blocks, setBlocks] = useState([]);

  // Connection compare
  const [connections, setConnections] = useState([]);
  const [activeConnId, setActiveConnId] = useState(null);
  const [theirSlots, setTheirSlots] = useState(new Set());

  // Initial load: my availability + connections + my schedule
  useEffect(() => {
    (async () => {
      let hadSaved = false;
      try {
        const mine = await api.getAvailability();
        if (mine?.slots?.length) {
          setSelected(new Set(mine.slots));
          hadSaved = true;
        }
      } catch (_) { /* ignore */ }
      try {
        const c = await api.getConnections();
        setConnections((c.connections || []).filter(x => x.status === "accepted"));
      } catch (_) { /* ignore */ }
      try {
        const s = await api.getSchedule();
        setBlocks(s.blocks || []);
      } catch (_) { /* ignore */ }
      // If the user already had saved slots, treat as seeded so we don't overwrite.
      setSeeded(hadSaved);
    })();
  }, []);

  // Build the set of slot keys covered by schedule blocks for the visible week.
  const scheduleBusy = useMemo(() => {
    const set = new Set();
    if (!blocks?.length) return set;
    days.forEach(d => {
      HOURS.forEach(h => {
        if (inScheduleBlock(d, h, blocks)) set.add(slotIso(d, h));
      });
    });
    return set;
  }, [days, blocks]);

  // First-time auto-seed: fill all non-busy waking hours so the user starts
  // from "free except scheduled". Runs only when there were no saved slots.
  useEffect(() => {
    if (seeded) return;
    const next = new Set();
    days.forEach(d => {
      HOURS.forEach(h => {
        const k = slotIso(d, h);
        if (!scheduleBusy.has(k)) next.add(k);
      });
    });
    setSelected(next);
    setSeeded(true);
  }, [seeded, days, scheduleBusy]);

  // When schedule changes after seeding, prune any selected slots that became busy.
  useEffect(() => {
    if (!seeded) return;
    setSelected(prev => {
      let changed = false;
      const next = new Set(prev);
      scheduleBusy.forEach(k => {
        if (next.has(k)) { next.delete(k); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [scheduleBusy, seeded]);

  // Whenever the active connection changes, fetch their slots.
  useEffect(() => {
    if (!activeConnId) { setTheirSlots(new Set()); return; }
    (async () => {
      try {
        const d = await api.getConnectionAvailability(activeConnId);
        setTheirSlots(new Set(d.slots || []));
      } catch (e) {
        setMsg(e.message);
        setTheirSlots(new Set());
      }
    })();
  }, [activeConnId]);

  function toggle(date, hour) {
    const iso = slotIso(date, hour);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  // Reseed the visible week from current schedule (manual override reset).
  function resetToSchedule() {
    const next = new Set();
    days.forEach(d => {
      HOURS.forEach(h => {
        const k = slotIso(d, h);
        if (!scheduleBusy.has(k)) next.add(k);
      });
    });
    setSelected(next);
    setMsg("Reset to schedule. Tap save to apply.");
  }

  async function submit() {
    setMsg("");
    setLoading(true);
    try {
      const slots = Array.from(selected).sort();
      const data = await api.setAvailability(slots);
      setMsg(`Saved ${data.count} slot(s).`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  const overlapToday = useMemo(() => {
    if (!activeConnId) return 0;
    let n = 0;
    HOURS.forEach(h => {
      const k = slotIso(selectedDay, h);
      if (selected.has(k) && theirSlots.has(k)) n++;
    });
    return n;
  }, [activeConnId, selected, theirSlots, selectedDay]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pick your free hours</Text>
      <Text style={styles.sub}>
        Auto-filled from your schedule. Tap to override. Pick a connection to overlay theirs.
      </Text>

      {/* Connection compare picker */}
      <Text style={styles.h2}>Compare with</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 12 }}
      >
        <Pressable
          style={[styles.connChip, !activeConnId && styles.connChipSel]}
          onPress={() => setActiveConnId(null)}
        >
          <Text style={[styles.connChipText, !activeConnId && styles.connChipTextSel]}>
            None
          </Text>
        </Pressable>
        {connections.length === 0 && (
          <Text style={[styles.sub, { alignSelf: "center", marginLeft: 8 }]}>
            No connections yet
          </Text>
        )}
        {connections.map(c => {
          const sel = activeConnId === c.other_id;
          return (
            <Pressable
              key={c.id}
              style={[styles.connChip, sel && styles.connChipSelBlue]}
              onPress={() => setActiveConnId(c.other_id)}
            >
              <Text style={[styles.connChipText, sel && styles.connChipTextSel]}>
                {c.other_name || `User #${c.other_id}`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!!activeConnId && (
        <Text style={styles.compareLine}>
          {theirSlots.size} of their slots · {overlapToday} overlap on {dateLabel(selectedDay)}
        </Text>
      )}

      <Text style={styles.h2}>Day</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 12 }}
      >
        {days.map((d) => {
          const isSel = d.toDateString() === selectedDay.toDateString();
          return (
            <Pressable
              key={d.toISOString()}
              style={[styles.dayChip, isSel && styles.dayChipSel]}
              onPress={() => setSelectedDay(d)}
            >
              <Text
                style={[styles.dayChipText, isSel && styles.dayChipTextSel]}
              >
                {dateLabel(d)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.toolbarRow}>
        <Text style={styles.h2}>Hours on {dateLabel(selectedDay)}</Text>
        <Pressable onPress={resetToSchedule} style={styles.resetBtn}>
          <Text style={styles.resetBtnText}>↺ Reset to schedule</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {HOURS.map((h) => {
          const iso = slotIso(selectedDay, h);
          const mine = selected.has(iso);
          const busy = scheduleBusy.has(iso);
          const theirs = !!activeConnId && theirSlots.has(iso);
          const both = mine && theirs;
          let chipStyle = [styles.hourChip];
          let textStyle = [styles.hourText];
          if (both) {
            chipStyle.push(styles.hourChipBoth);
            textStyle.push(styles.hourTextSel);
          } else if (mine) {
            chipStyle.push(styles.hourChipSel);
            textStyle.push(styles.hourTextSel);
          } else if (busy) {
            chipStyle.push(styles.hourChipBusy);
            textStyle.push(styles.hourTextBusy);
          } else if (theirs) {
            chipStyle.push(styles.hourChipTheirs);
            textStyle.push({ color: "#1d4ed8" });
          }
          return (
            <Pressable
              key={iso}
              style={chipStyle}
              onPress={() => toggle(selectedDay, h)}
            >
              <Text style={textStyle}>{hourLabel(h)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#16a34a" }]} />
          <Text style={styles.legendText}>You free</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#ef4444" }]} />
          <Text style={styles.legendText}>Schedule busy</Text>
        </View>
        {!!activeConnId && (
          <>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: "#dbeafe", borderWidth: 1, borderColor: "#1d4ed8", borderStyle: "dashed" },
                ]}
              />
              <Text style={styles.legendText}>They free</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#15803d", borderWidth: 1.5, borderColor: "#fff" }]} />
              <Text style={styles.legendText}>Both free</Text>
            </View>
          </>
        )}
      </View>

      <Text style={styles.summary}>
        {selected.size} of your slot(s) selected (across all days)
      </Text>

      <Pressable
        style={[styles.button, loading && styles.disabled]}
        onPress={submit}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Saving..." : "Save Availability"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.purple]}
        onPress={() => router.push("/overlap")}
      >
        <Text style={styles.buttonText}>See Overlap →</Text>
      </Pressable>

      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 22, fontWeight: "bold" },
  sub: { color: "#666", marginBottom: 16 },
  h2: { fontSize: 16, fontWeight: "600", marginVertical: 8 },
  compareLine: { color: "#555", marginBottom: 8 },

  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  resetBtnText: { color: "#444", fontSize: 12, fontWeight: "600" },

  connChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 20,
    marginRight: 8,
    backgroundColor: "white",
  },
  connChipSel:     { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  connChipSelBlue: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  connChipText:    { color: "#333" },
  connChipTextSel: { color: "white", fontWeight: "600" },

  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 20,
    marginRight: 8,
    backgroundColor: "white",
  },
  dayChipSel: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  dayChipText: { color: "#333" },
  dayChipTextSel: { color: "white", fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  hourChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    margin: 4,
    backgroundColor: "white",
    minWidth: 96,
    alignItems: "center",
  },
  hourChipSel:    { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  hourChipBusy:   { backgroundColor: "#fee2e2", borderColor: "#ef4444" },
  hourChipTheirs: { backgroundColor: "#dbeafe", borderColor: "#1d4ed8", borderStyle: "dashed" },
  hourChipBoth:   { backgroundColor: "#15803d", borderColor: "#fff", borderWidth: 2 },
  hourText:       { color: "#333" },
  hourTextSel:    { color: "white", fontWeight: "600" },
  hourTextBusy:   { color: "#b91c1c" },

  legendRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 14, marginBottom: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 3, marginRight: 6 },
  legendText: { color: "#444", fontSize: 12 },

  summary: { textAlign: "center", marginVertical: 12, color: "#444" },
  button: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  disabled: { opacity: 0.6 },
  purple: { backgroundColor: "#7c3aed" },
  buttonText: { color: "white", fontWeight: "600" },
  msg: { textAlign: "center", marginTop: 12, color: "#444" },
});
