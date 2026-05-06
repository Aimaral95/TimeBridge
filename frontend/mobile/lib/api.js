import { API_URL } from "../config";
import { getToken } from "./auth";

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Network error: ${e.message}. Is the backend running at ${API_URL}?`);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // ignore – not all responses are JSON
  }

  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  register: (name, email, password, timezone) =>
    request("/register", {
      method: "POST",
      auth: false,
      body: { name, email, password, timezone },
    }),
  login: (email, password) =>
    request("/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),

  // Password reset
  forgotPassword: (email) =>
    request("/forgot-password", { method: "POST", auth: false, body: { email } }),
  resetPassword: (token, password) =>
    request("/reset-password", { method: "POST", auth: false, body: { token, password } }),

  createInvite: () => request("/connections/invite", { method: "POST" }),
  joinInvite: (invite_code) =>
    request("/connections/join", { method: "POST", body: { invite_code } }),
  getConnections: () => request("/connections"),
  getConnectionAvailability: (otherId) =>
    request(`/connections/${otherId}/availability`),

  setAvailability: (slots) =>
    request("/availability", { method: "POST", body: { slots } }),
  getAvailability: () => request("/availability"),
  getOverlap: () => request("/availability/overlap"),

  getSchedule: () => request("/schedule"),
};
