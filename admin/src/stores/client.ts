import { reactive } from "vue";

const LS_TOKEN = "boltstore_token";

interface ConnectionState {
  baseUrl: string;
  token: string;
  connected: boolean;
  adminEmail: string;
  sessionLoading: boolean;
}

function loadSavedState(): Partial<ConnectionState> {
  try {
    const token = localStorage.getItem(LS_TOKEN);
    if (token) return { token, baseUrl: window.location.origin };
  } catch {}
  return {};
}

const state = reactive<ConnectionState>({
  baseUrl: window.location.origin,
  token: "",
  connected: false,
  adminEmail: "",
  sessionLoading: !!loadSavedState().token,
  ...loadSavedState(),
});

export function useConnection() {
  async function connect(token: string) {
    state.token = token;
    state.baseUrl = window.location.origin;
    try {
      const data = await apiRequest<{ id: string; email: string }>("GET", "/api/admin/me");
      state.adminEmail = data.email;
      state.connected = true;
      state.sessionLoading = false;
      localStorage.setItem(LS_TOKEN, token);
    } catch {
      state.token = "";
      state.connected = false;
      localStorage.removeItem(LS_TOKEN);
      throw new Error("Session invalid");
    }
  }

  function disconnect() {
    apiRequest("POST", "/api/admin/logout").catch(() => {});
    state.token = "";
    state.connected = false;
    state.adminEmail = "";
    state.sessionLoading = false;
    localStorage.removeItem(LS_TOKEN);
  }

  async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await globalThis.fetch(`${state.baseUrl}${path}`, init);
    const text = await res.text();
    if (!text) throw new Error(`Request failed (${res.status})`);
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.error.message);
    return json.data ?? json;
  }

  // Auto-restore session on mount
  if (state.token && !state.adminEmail) {
    connect(state.token)
      .catch(() => { state.sessionLoading = false; });
  }

  return { state, connect, disconnect, apiRequest };
}
