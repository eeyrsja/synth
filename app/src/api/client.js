/**
 * API client for backend communication.
 */

export async function apiFetch(path, opts = {}, authToken = null) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(res.ok ? "Invalid server response" : `Server error (${res.status})`);
  }
  if (!res.ok) {
    if (res.status === 401 && authToken) {
      // Token expired or server restarted with new secret — clear stale auth
      localStorage.removeItem("wavecraft_token");
      localStorage.removeItem("wavecraft_user");
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function loginApi(email, password) {
  return apiFetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signupApi(email, password, displayName) {
  return apiFetch("/api/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName }),
  });
}

export async function fetchPresetsApi(authToken, type = "synth") {
  return apiFetch(`/api/presets?type=${encodeURIComponent(type)}`, {}, authToken);
}

export async function fetchPresetApi(id, authToken) {
  return apiFetch(`/api/presets/${id}`, {}, authToken);
}

export async function savePresetApi(name, data, authToken, type = "synth") {
  return apiFetch("/api/presets", {
    method: "POST",
    body: JSON.stringify({ name, data, type }),
  }, authToken);
}

export async function deletePresetApi(id, authToken) {
  return apiFetch(`/api/presets/${id}`, { method: "DELETE" }, authToken);
}

export async function fetchStateApi(authToken) {
  return apiFetch("/api/state", {}, authToken);
}

export async function saveStateApi(data, authToken) {
  return apiFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify({ data }),
  }, authToken);
}

export async function checkoutApi(authToken) {
  return apiFetch("/api/checkout", { method: "POST" }, authToken);
}

export async function refreshTokenApi(authToken) {
  return apiFetch("/api/refresh-token", { method: "POST" }, authToken);
}
