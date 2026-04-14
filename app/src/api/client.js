/**
 * API client for backend communication.
 */

export async function apiFetch(path, opts = {}, authToken = null) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
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

export async function fetchCloudPresetsApi(authToken) {
  return apiFetch("/api/presets", {}, authToken);
}

export async function fetchCloudPresetApi(id, authToken) {
  return apiFetch(`/api/presets/${id}`, {}, authToken);
}

export async function saveCloudPresetApi(name, data, authToken) {
  return apiFetch("/api/presets", {
    method: "POST",
    body: JSON.stringify({ name, data }),
  }, authToken);
}

export async function deleteCloudPresetApi(id, authToken) {
  return apiFetch(`/api/presets/${id}`, { method: "DELETE" }, authToken);
}
