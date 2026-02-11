import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function UserSelect({
  label,
  disabledId,
  valueId,
  onChangeId,
  selectId = "userSelect",
  enabled = true,
}) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");

  async function refresh() {
    if (!enabled) return;
    setErr("");
    try {
      const list = await api.listUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      setUsers([]);
      setErr(String(e?.message || e || "Failed to load users"));
    }
  }

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setErr("");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const list = await api.listUsers();
        if (!cancelled) {
          setUsers(Array.isArray(list) ? list : []);
          setErr("");
        }
      } catch (e) {
        if (!cancelled) {
          setUsers([]);
          setErr(String(e?.message || e || "Failed to load users"));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return (
    <div className="card compact" style={{ minWidth: 280 }}>
      <label className="label" htmlFor={selectId}>
        {label}
      </label>

      <div className="row" style={{ alignItems: "center" }}>
        <select
          id={selectId}
          className="input"
          value={valueId ?? ""}
          onChange={(e) =>
            onChangeId(e.target.value ? Number(e.target.value) : null)
          }
          style={{ minWidth: 220 }}
        >
          <option value="">Select user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id} disabled={disabledId === u.id}>
              {u.username} (id={u.id})
            </option>
          ))}
        </select>

        <button type="button" className="btn" onClick={refresh}>
          Refresh
        </button>
      </div>

      {err ? (
        <div className="error" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
