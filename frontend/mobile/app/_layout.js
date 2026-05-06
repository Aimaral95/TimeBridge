import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#2563eb" },
        headerTintColor: "white",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "TimeBridge" }} />
      <Stack.Screen name="forgot-password" options={{ title: "Forgot Password" }} />
      <Stack.Screen name="reset-password" options={{ title: "Reset Password" }} />
      <Stack.Screen name="home" options={{ title: "Home" }} />
      <Stack.Screen name="availability" options={{ title: "My Availability" }} />
      <Stack.Screen name="overlap" options={{ title: "Overlapping Times" }} />
    </Stack>
  );
}
