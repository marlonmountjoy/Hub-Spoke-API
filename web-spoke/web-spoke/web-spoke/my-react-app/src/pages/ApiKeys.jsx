import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

const KEY_NAME_RE = /^[-A-Za-z0-9 .,_/#+()&'":]{1,64}$/;

const NULL_CHAR = String.fromCharCode(0);

function clean(s) {
  return (s || "").split(NULL_CHAR).join("").trim();
}

function isSafeKeyName(s) {
  const v = clean(s);
  if (!v) return false;
  if (/[<>`]/.test(v)) return false;
  return KEY_NAME_RE.test(v);
}

export default function ApiKeys({ me }) {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Modal for showing a newly created key (plaintext shown once)
  const [showModal, setShowModal] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [createdMeta, setCreatedMeta] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const keyBoxRef = useRef(null);

  const canUse = useMemo(() => !!me, [me]);

  async function refresh() {
    if (!canUse) return;
    setErr("");
    setLoading(true);
    try {
      const list = await api.listApiKeys();
      // Hide revoked keys in the UI (they are still kept server-side as revoked=true)
      const active = (Array.isArray(list) ? list : []).filter(
        (k) => !k.revoked,
      );
      setKeys(active);
    } catch (e) {
      setErr(String(e?.message || e || "Failed to load API keys"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  async function createKey() {
    if (!canUse) return;
    setErr("");
    setCopyStatus("");

    const n = clean(name);
    if (!n) return;

    if (!isSafeKeyName(n)) {
      setErr(
        "Key name has unsupported characters. Use letters/numbers and common punctuation only (no < >).",
      );
      return;
    }

    try {
      const res = await api.createApiKey(n);

      const k = String(res?.api_key || "");
      setCreatedKey(k);
      setCreatedMeta({
        id: res?.id,
        name: res?.name,
        key_prefix: res?.key_prefix,
        created_at: res?.created_at,
      });

      setShowModal(true);
      setName("");
      await refresh();

      setTimeout(() => keyBoxRef.current?.focus(), 50);
    } catch (e) {
      setErr(String(e?.message || e || "Create API key failed"));
    }
  }

  async function revokeKey(k) {
    const ok = window.confirm(`Revoke API key "${k.name}"?`);
    if (!ok) return;

    setErr("");

    // Optimistic UI: remove from the table immediately after confirming.
    setKeys((prev) => prev.filter((x) => x.id !== k.id));

    try {
      await api.revokeApiKey(k.id);
      // Keep the UI consistent with the server:
      await refresh();
    } catch (e) {
      // Put it back if revoke fails
      setKeys((prev) => [k, ...prev].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)));
      setErr(String(e?.message || e || "Revoke failed"));
    }
  }

  async function copyKey() {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Copy failed. Select and copy manually.");
    }
  }

  if (!me) {
    return (
      <div style={{ padding: 12 }}>
        <h2>API Keys</h2>
        <div className="small" role="alert">
          Log in with username/password to manage API keys.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ margin: 0 }}>API Keys</h2>
      <div className="small" style={{ marginTop: 6 }}>
        API keys are for the public gateway (X-API-Key). Your web UI prefers
        password login (Bearer token).
      </div>

      {err ? (
        <div className="small" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}

      <div
        className="card"
        style={{
          marginTop: 12,
          padding: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <label className="label" htmlFor="api-key-name">
            New key name
          </label>
          <input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. public-web, cli, integration…"
          />
        </div>

        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" onClick={createKey}>
            Create key
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <h3 className="h3">Existing keys</h3>

        {loading ? <div className="small">Loading…</div> : null}

        <div className="tableWrap">
          <table className="table responsiveStack">
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Prefix</th>
                <th align="left">Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td data-label="Name">{k.name}</td>
                  <td data-label="Prefix" className="small">
                    {k.key_prefix || "—"}
                  </td>
                  <td data-label="Created" className="small">
                    {k.created_at || "—"}
                  </td>
                  <td data-label="Action" style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => revokeKey(k)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}

              {keys.length === 0 && !loading ? (
                <tr>
                  <td colSpan={4} className="small">
                    No API keys yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {showModal ? (
        <dialog
          open
          aria-modal="true"
          aria-labelledby="newkey-title"
          style={{
            width: "min(760px, 96vw)",
            maxWidth: "96vw",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 0,
            background: "var(--surface)",
            color: "var(--text)",
          }}
          onClose={() => setShowModal(false)}
        >
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <h2 id="newkey-title" style={{ margin: 0, fontSize: "1.05rem" }}>
              New API key (shown once)
            </h2>

            <div style={{ marginLeft: "auto" }}>
              <button type="button" onClick={() => setShowModal(false)}>
                Close
              </button>
            </div>
          </div>

          <div style={{ padding: 14 }}>
            <div className="small" style={{ marginBottom: 10 }}>
              Save this key now. You will not be able to view it again.
            </div>

            <div className="small" style={{ marginBottom: 8 }}>
              <strong>Name:</strong> {createdMeta?.name || "—"} •{" "}
              <strong>Prefix:</strong> {createdMeta?.key_prefix || "—"}
            </div>

            <textarea
              ref={keyBoxRef}
              className="input"
              rows={3}
              value={createdKey}
              readOnly
              aria-label="New API key"
            />

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <button type="button" onClick={copyKey}>
                Copy
              </button>
              <div className="small" role="status" aria-live="polite">
                {copyStatus}
              </div>
            </div>
          </div>

          <style>{`
            dialog::backdrop { background: rgba(0,0,0,0.55); }
          `}</style>
        </dialog>
      ) : null}
    </div>
  );
}
