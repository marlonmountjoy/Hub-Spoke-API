const KEY_STORAGE = "hub_api_key"; // optional: public gateway key (X-API-Key)
const ACCESS_STORAGE = "hub_access_token"; // password-login session token (Authorization: Bearer)
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/+$/,
  "",
);

function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}

function setApiKey(k) {
  localStorage.setItem(KEY_STORAGE, k);
}

function clearApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_STORAGE) || "";
}

function setAccessToken(t) {
  localStorage.setItem(ACCESS_STORAGE, t);
}

function clearAccessToken() {
  localStorage.removeItem(ACCESS_STORAGE);
}

function isNetworkError(err) {
  return err instanceof TypeError;
}

function stripControlChars(s, { allowNewlines = true } = {}) {
  // Remove ASCII control chars except: tab, LF, CR (optional).
  const keep = allowNewlines ? /[\t\n\r]/ : /[\t]/;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    if (code === 0) continue; // null byte
    if (code < 32) {
      if (keep.test(ch)) out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function deepSanitizeJson(value) {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // Keep user content but remove control chars that can cause weird parsing/logging issues.
    return stripControlChars(value, { allowNewlines: true });
  }

  if (Array.isArray(value)) return value.map((v) => deepSanitizeJson(v));

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepSanitizeJson(v);
    return out;
  }

  return value;
}

async function http(method, path, { json, formData } = {}) {
  const headers = {};

  // Prefer Bearer token (password login). This is what the web-spoke uses.
  const accessToken = getAccessToken();
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  // Optional: API key for public-gateway testing or non-password clients.
  const apiKey = getApiKey();
  if (apiKey) headers["X-API-Key"] = apiKey;

  let body = undefined;

  if (formData) {
    body = formData;
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(deepSanitizeJson(json));
  }

  const url = `${API_BASE_URL}${path}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    if (isNetworkError(e)) {
      throw new Error(
        `Cannot reach hub API at ${API_BASE_URL || "[missing VITE_API_BASE_URL]"}.`,
      );
    }
    throw e;
  }

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "Unauthorized (401). Log in with username/password (top bar) or provide a valid API key.",
      );
    }

    const msg =
      (data && typeof data === "object" && data.message) ||
      (typeof data === "string" && data) ||
      `${method} ${url} failed (${res.status})`;

    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return data;
}

let usersCache = null;
let usersCacheAt = 0;
const USERS_CACHE_MS = 30_000;

async function getUsersCached() {
  const now = Date.now();
  if (usersCache && now - usersCacheAt < USERS_CACHE_MS) return usersCache;

  const list = await http("GET", "/api/users");
  usersCache = Array.isArray(list) ? list : [];
  usersCacheAt = now;
  return usersCache;
}

export const api = {
  // Optional API key helpers (public gateway)
  getApiKey,
  setApiKey,
  clearApiKey,

  // Password-login Bearer token helpers
  getAccessToken,
  setAccessToken,
  clearAccessToken,

  health() {
    return http("GET", "/api/health");
  },

  // -----------------------------
  // Auth
  // -----------------------------
  register(username, password) {
    return http("POST", "/api/auth/register", { json: { username, password } });
  },

  async login(username, password) {
    const res = await http("POST", "/api/auth/login", {
      json: { username, password },
    });
    const token = String(res?.access_token || "");
    if (token) setAccessToken(token);
    return res;
  },

  logout() {
    clearAccessToken();
  },

  me() {
    return http("GET", "/api/auth/me");
  },

  // -----------------------------
  // Users
  // -----------------------------
  listUsers() {
    return http("GET", "/api/users");
  },

  listUsersCached() {
    return getUsersCached();
  },

  // -----------------------------
  // API Keys (public gateway)
  // -----------------------------
  listApiKeys() {
    return http("GET", "/api/api-keys");
  },

  createApiKey(name) {
    return http("POST", "/api/api-keys", { json: { name } });
  },

  revokeApiKey(keyId) {
    return http("DELETE", `/api/api-keys/${keyId}`);
  },

  // -----------------------------
  // Messenger
  // -----------------------------
  listMessages(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return http("GET", `/api/messages${suffix}`);
  },

  sendMessage(payload) {
    return http("POST", "/api/messages", { json: payload });
  },

  // -----------------------------
  // Photo Vault
  // -----------------------------
  listPhotos() {
    return http("GET", "/api/photos");
  },

  uploadPhoto(file) {
    const fd = new FormData();
    fd.append("file", file);
    return http("POST", "/api/photos/upload", { formData: fd });
  },

  deletePhoto(photoId) {
    return http("DELETE", `/api/photos/${photoId}`);
  },

  issuePhotoToken(photoId) {
    return http("POST", `/api/photos/${photoId}/token`);
  },

  photoViewUrl(photoId, token) {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${API_BASE_URL}/api/photos/${photoId}/view${q}`;
  },

  photoDownloadUrl(photoId, token) {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${API_BASE_URL}/api/photos/${photoId}/download${q}`;
  },

  // -----------------------------
  // Tool Inventory
  // -----------------------------
  listToolGroups() {
    return http("GET", "/api/tool-groups");
  },

  createToolGroup(payload) {
    return http("POST", "/api/tool-groups", { json: payload });
  },

  deleteToolGroup(groupId) {
    return http("DELETE", `/api/tool-groups/${groupId}`);
  },

  listTools(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return http("GET", `/api/tools${suffix}`);
  },

  createTool(payload) {
    return http("POST", "/api/tools", { json: payload });
  },

  updateTool(toolId, payload) {
    return http("PATCH", `/api/tools/${toolId}`, { json: payload });
  },

  deleteTool(toolId) {
    return http("DELETE", `/api/tools/${toolId}`);
  },

  getTool(toolId) {
    return http("GET", `/api/tools/${toolId}`);
  },

  listToolPhotos(toolId) {
    return http("GET", `/api/tools/${toolId}/photos`);
  },

  attachToolPhoto(toolId, photoIdOrPayload, isPrimary = false) {
    if (
      photoIdOrPayload &&
      typeof photoIdOrPayload === "object" &&
      !Array.isArray(photoIdOrPayload)
    ) {
      return http("POST", `/api/tools/${toolId}/photos`, {
        json: photoIdOrPayload,
      });
    }
    return http("POST", `/api/tools/${toolId}/photos`, {
      json: { photo_id: photoIdOrPayload, is_primary: isPrimary },
    });
  },

  deleteToolPhoto(toolId, toolPhotoId) {
    return http("DELETE", `/api/tools/${toolId}/photos/${toolPhotoId}`);
  },

  setPrimaryToolPhoto(toolId, toolPhotoId) {
    return http("POST", `/api/tools/${toolId}/photos/${toolPhotoId}/primary`);
  },

  setToolPhotoPrimary(toolId, toolPhotoId) {
    return api.setPrimaryToolPhoto(toolId, toolPhotoId);
  },
};
