// No-auth API client THROUGH Vite proxy.
// Browser calls /api on the Vite server; Vite forwards to Flask on :5000.

async function http(method, path, { json, formData } = {}) {
  const headers = {};
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: formData
      ? formData
      : json !== undefined
        ? JSON.stringify(json)
        : undefined,
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && data.message) ||
      (typeof data === "string" && data) ||
      `${method} ${path} failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

export const api = {
  health() {
    return http("GET", "/api/health");
  },

  listUsers() {
    return http("GET", "/api/users");
  },

  createUser(username) {
    return http("POST", "/api/users", { json: { username } });
  },

  listMessages(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return http("GET", `/api/messages${suffix}`);
  },

  // expects: { sender_id, recipient_id, body }
  sendMessage(payload) {
    return http("POST", "/api/messages", { json: payload });
  },

  listPhotos(owner_id) {
    const suffix = owner_id ? `?owner_id=${encodeURIComponent(owner_id)}` : "";
    return http("GET", `/api/photos${suffix}`);
  },

  uploadPhoto(file, owner_id) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("owner_id", String(owner_id));
    return http("POST", "/api/photos/upload", { formData: fd });
  },

  photoDownloadUrl(photoId) {
    // IMPORTANT: use proxied URL so it works from the web app
    return `/api/photos/${photoId}/download`;
  },
};
