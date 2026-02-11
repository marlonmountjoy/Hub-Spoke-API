import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

function generateKey() {
  // Creates a copyable token. Not used by the backend (no-auth mode).
  try {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    // url-safe-ish base64
    const b64 = btoa(String.fromCharCode(...bytes));
    return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  } catch {
    return `demo_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

export default function AuthBar({ onUserCreated }) {
  const [status, setStatus] = useState({ ok: null, time_utc: "" });
  const [newUsername, setNewUsername] = useState("");
  const [err, setErr] = useState("");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [createdUser, setCreatedUser] = useState(null);
  const [createdKey, setCreatedKey] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const keyBoxRef = useRef(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setStatus(h))
      .catch(() => setStatus({ ok: null, time_utc: "" }));
  }, []);

  async function createUser() {
    setErr("");
    setCopyStatus("");

    const username = (newUsername || "").trim();
    if (!username) return;

    try {
      const u = await api.createUser(username);

      // Generate a copyable "key" for demo purposes (not required by hub)
      const k = generateKey();

      // Store it so you can retrieve later if you want
      // (keyed by user id, since username could change later)
      if (u?.id != null) {
        localStorage.setItem(`hub_demo_key_user_${u.id}`, k);
      }

      setCreatedUser(u);
      setCreatedKey(k);
      setShowModal(true);
      setNewUsername("");

      if (onUserCreated) onUserCreated(u);
    } catch (e) {
      setErr(String(e?.message || e || "Create user failed"));
    }
  }

  async function copyKey() {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopyStatus("Copied.");
    } catch {
      if (keyBoxRef.current) {
        keyBoxRef.current.focus();
        keyBoxRef.current.select();
      }
      setCopyStatus("Select the key and press Ctrl+C to copy.");
    }
  }

  function closeModal() {
    setShowModal(false);
    setCopyStatus("");
  }

  useEffect(() => {
    if (!showModal) return;
    setTimeout(() => {
      if (keyBoxRef.current) {
        keyBoxRef.current.focus();
        keyBoxRef.current.select();
      }
    }, 0);
  }, [showModal]);

  return (
    <section className="card" aria-label="Hub status and user creation">
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <div>
          <h1 className="h1">Hub-Spoke Web Spoke</h1>
          <div className="small" aria-live="polite">
            Hub: {status.ok ? "OK" : "Unknown"}{" "}
            {status.time_utc ? `(${status.time_utc})` : ""}
          </div>
        </div>

        <div className="small" style={{ textAlign: "right" }}>
          No authentication (demo mode)
        </div>
      </div>

      <div className="card compact" style={{ marginTop: 12 }}>
        <h2 className="h2">Create user</h2>

        <label className="label" htmlFor="newUsernameInput">
          Username
        </label>

        <div className="row" style={{ alignItems: "center" }}>
          <input
            id="newUsernameInput"
            className="input"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="New username"
            style={{ flex: 1, minWidth: 220 }}
            autoComplete="username"
          />
          <button type="button" className="btn primary" onClick={createUser}>
            Create
          </button>
        </div>

        <div className="small" style={{ marginTop: 8 }}>
          After creation, you’ll see a copyable key box (for your demo/UI). The
          hub does not require it.
        </div>
      </div>

      {err ? (
        <div className="error" role="alert" style={{ marginTop: 12 }}>
          {err}
        </div>
      ) : null}

      {showModal ? (
        <div
          className="modalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="New user key"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeModal();
          }}
          onMouseDown={(e) => {
            if (e.target.classList.contains("modalBackdrop")) closeModal();
          }}
        >
          <div className="modal">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <h2 className="h2" style={{ margin: 0 }}>
                User created
              </h2>
              <button type="button" className="btn" onClick={closeModal}>
                Close
              </button>
            </div>

            <p className="small" style={{ marginTop: 8 }}>
              User: <strong>{createdUser?.username}</strong>{" "}
              {createdUser?.id != null ? `(id=${createdUser.id})` : ""}
            </p>

            <label className="label" htmlFor="keyBox">
              Copyable key (demo)
            </label>

            <textarea
              id="keyBox"
              ref={keyBoxRef}
              className="codeBox"
              readOnly
              value={createdKey}
              rows={3}
            />

            <div
              className="row"
              style={{ marginTop: 10, alignItems: "center" }}
            >
              <button type="button" className="btn primary" onClick={copyKey}>
                Copy key
              </button>
              <div className="small" aria-live="polite">
                {copyStatus}
              </div>
            </div>

            <div className="notice" style={{ marginTop: 12 }}>
              This key is for the web UI / project demo. The hub API is
              currently not enforcing authentication.
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
