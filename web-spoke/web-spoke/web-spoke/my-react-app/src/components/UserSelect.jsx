import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

/**
 * UserSelect
 * ----------
 * Supports two prop styles:
 * 1) "explicit" props (preferred):
 *    - label, selectId, valueId, onChangeId, disabledId, enabled
 * 2) legacy-style props (for convenience/back-compat):
 *    - label, id, value, onChange, disabled, enabled
 */
export default function UserSelect(props) {
  const {
    // Preferred prop names
    label,
    selectId,
    valueId,
    onChangeId,
    disabledId = null,

    // Legacy prop names
    id,
    value,
    onChange,
    disabled,

    enabled = true,
  } = props;

  const realSelectId = selectId ?? id;
  const realValueId = valueId ?? value ?? null;
  const realOnChangeId = onChangeId ?? onChange;
  const realDisabledId = disabledId ?? disabled ?? null;

  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const safeValue = useMemo(() => {
    if (realValueId === null || realValueId === undefined) return "";
    return String(realValueId);
  }, [realValueId]);

  useEffect(() => {
    async function loadUsers() {
      if (!enabled) {
        setUsers([]);
        setErr("");
        setBusy(false);
        return;
      }

      setErr("");
      setBusy(true);

      try {
        const list = await api.listUsers();
        setUsers(Array.isArray(list) ? list : []);
      } catch (e) {
        setUsers([]);
        setErr(String(e?.message || e || "Failed to load users"));
      } finally {
        setBusy(false);
      }
    }

    loadUsers();
  }, [enabled]);

  return (
    <div style={{ marginTop: 10 }}>
      {label ? (
        <label className="label" htmlFor={realSelectId}>
          {label}
        </label>
      ) : null}

      <select
        id={realSelectId}
        className="input"
        value={safeValue}
        onChange={(e) => {
          if (!realOnChangeId) return;
          const raw = e.target.value;
          realOnChangeId(raw ? Number(raw) : null);
        }}
        disabled={!enabled || busy}
      >
        <option value="">
          {enabled ? "Select user…" : "Log in to select…"}
        </option>

        {users.map((u) => (
          <option
            key={u.id}
            value={String(u.id)}
            disabled={
              realDisabledId != null && Number(u.id) === Number(realDisabledId)
            }
          >
            {u.username} (id={u.id})
          </option>
        ))}
      </select>

      {err ? (
        <div className="small" role="alert" style={{ marginTop: 6 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
