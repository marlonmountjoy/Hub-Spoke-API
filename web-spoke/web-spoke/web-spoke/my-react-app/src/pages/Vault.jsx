import React, { useMemo, useState, useEffect } from "react";
import { api } from "../api.js";

function isImageFilename(name) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || "");
}

function normalize(s) {
  return (s || "").toLowerCase();
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return String(bytes);
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function PhotoRow({ photo, busy, onDeleted }) {
  const [token, setToken] = useState("");
  const [tokErr, setTokErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [rowErr, setRowErr] = useState("");

  const img = isImageFilename(photo.original_name);

  useEffect(() => {
    let cancelled = false;

    async function loadToken() {
      setTokErr("");
      setToken("");
      try {
        const res = await api.issuePhotoToken(photo.id);
        if (cancelled) return;
        setToken(String(res.token || ""));
      } catch (e) {
        if (cancelled) return;
        setTokErr(String(e?.message || e || "Token error"));
      }
    }

    loadToken();
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  async function doDelete() {
    setRowErr("");
    const ok = window.confirm(
      `Delete "${photo.original_name}"?\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    setDeleting(true);
    try {
      await api.deletePhoto(photo.id);
      onDeleted();
    } catch (e) {
      setRowErr(String(e?.message || e || "Delete failed"));
    } finally {
      setDeleting(false);
    }
  }

  const viewUrl = api.photoViewUrl(photo.id, token);
  const downloadUrl = api.photoDownloadUrl(photo.id, token);

  return (
    <div className="item">
      <div className="row" style={{ alignItems: "flex-start" }}>
        {img ? (
          <div style={{ width: "min(320px, 100%)" }}>
            <img
              src={viewUrl}
              alt={photo.original_name}
              style={{
                maxWidth: "100%",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
              loading="lazy"
            />
          </div>
        ) : null}

        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 800 }}>{photo.original_name}</div>
          <div className="small">
            id={photo.id} • {formatBytes(photo.size_bytes)} •{" "}
            {formatDate(photo.created_at)}
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              Download
            </a>
            {img ? (
              <a href={viewUrl} target="_blank" rel="noreferrer">
                Open preview
              </a>
            ) : null}

            <span style={{ flex: 1 }} />

            <button
              type="button"
              className="btn"
              onClick={doDelete}
              disabled={busy || deleting}
              aria-disabled={busy || deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>

          {tokErr ? (
            <div className="small" role="alert" style={{ marginTop: 8 }}>
              {tokErr}
            </div>
          ) : null}

          {rowErr ? (
            <div className="small" role="alert" style={{ marginTop: 8 }}>
              {rowErr}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function Vault({ me }) {
  const [photos, setPhotos] = useState([]);
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filterMode, setFilterMode] = useState("all");

  const canUse = useMemo(() => !!me, [me]);

  async function refresh() {
    if (!canUse) return;
    setErr("");
    setBusy(true);
    try {
      const list = await api.listPhotos();
      setPhotos(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(String(e?.message || e || "Failed to load files"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Auto-load the vault whenever you log in / switch users.
    if (!me) {
      setPhotos([]);
      setErr("");
      setBusy(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  async function upload() {
    if (!canUse || !file) return;
    setErr("");
    setBusy(true);
    try {
      await api.uploadPhoto(file);
      setFile(null);
      await refresh();
    } catch (e) {
      setErr(String(e?.message || e || "Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  const view = useMemo(() => {
    const q = normalize(search);
    let items = [...photos];

    if (filterMode === "images")
      items = items.filter((p) => isImageFilename(p.original_name));
    if (filterMode === "nonimages")
      items = items.filter((p) => !isImageFilename(p.original_name));

    if (q) {
      items = items.filter((p) => {
        const hay = normalize(
          `${p.original_name} ${p.created_at} ${p.id} ${p.size_bytes}`,
        );
        return hay.includes(q);
      });
    }

    items.sort((a, b) => {
      if (sortBy === "newest") return (b.id ?? 0) - (a.id ?? 0);
      if (sortBy === "oldest") return (a.id ?? 0) - (b.id ?? 0);
      if (sortBy === "name")
        return normalize(a.original_name).localeCompare(
          normalize(b.original_name),
        );
      if (sortBy === "size") return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
      return 0;
    });

    return items;
  }, [photos, search, sortBy, filterMode]);

  const fileInputId = "vaultFile";
  const searchId = "vaultSearch";
  const sortId = "vaultSort";
  const filterId = "vaultFilter";

  return (
    <section className="card" aria-label="Vault">
      <h2 className="h2">Vault</h2>

      {!me ? (
        <div className="notice" style={{ marginTop: 10 }}>
          Log in to use Vault.
        </div>
      ) : null}

      <div
        className="card compact"
        aria-busy={busy ? "true" : "false"}
        style={{ marginTop: 12 }}
      >
        <div className="row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="label" htmlFor={fileInputId}>
              Upload file
            </label>
            <input
              id={fileInputId}
              type="file"
              disabled={!canUse || busy}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={upload}
            disabled={!canUse || !file || busy}
          >
            Upload
          </button>
        </div>
      </div>

      <div className="card compact" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="label" htmlFor={searchId}>
              Search files
            </label>
            <input
              id={searchId}
              className="input"
              placeholder="Search by filename, id, date, size…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!canUse}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label className="label" htmlFor={sortId}>
              Sort
            </label>
            <select
              id={sortId}
              className="input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              disabled={!canUse}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor={filterId}>
              Filter
            </label>
            <select
              id={filterId}
              className="input"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
              disabled={!canUse}
            >
              <option value="all">All</option>
              <option value="images">Images only</option>
              <option value="nonimages">Non-images only</option>
            </select>
          </div>

          <div
            className="small toolbarMeta"
            aria-live="polite"
          >
            Showing {view.length} of {photos.length}
          </div>
        </div>
      </div>

      <div className="card compact" style={{ marginTop: 12 }}>
        {view.length === 0 ? (
          <div className="small">(no files match)</div>
        ) : (
          <div className="list">
            {view.map((p) => (
              <PhotoRow key={p.id} photo={p} busy={busy} onDeleted={refresh} />
            ))}
          </div>
        )}
      </div>

      {err ? (
        <div className="error" role="alert" style={{ marginTop: 12 }}>
          {err}
        </div>
      ) : null}
    </section>
  );
}
