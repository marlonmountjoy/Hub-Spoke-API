import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import UserSelect from "../components/UserSelect.jsx";

function isImageFilename(name) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || "");
}

function normalize(s) {
  return (s || "").toLowerCase();
}

export default function Vault() {
  const [ownerId, setOwnerId] = useState(null);

  const [photos, setPhotos] = useState([]);
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filterMode, setFilterMode] = useState("all");
  const [thumbWidth, setThumbWidth] = useState(220);

  const canUse = useMemo(() => !!ownerId, [ownerId]);

  async function refresh() {
    if (!canUse) return;
    setErr("");
    setBusy(true);
    try {
      const list = await api.listPhotos(ownerId);
      setPhotos(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(String(e?.message || e || "Failed to load files"));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!canUse || !file) return;
    setErr("");
    setBusy(true);
    try {
      await api.uploadPhoto(file, ownerId);
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
  const sliderId = "vaultThumb";

  return (
    <section className="card" aria-label="Vault">
      <h2 className="h2">Vault</h2>

      <div className="card compact" style={{ marginTop: 12 }}>
        <h3 className="h3">Owner</h3>
        <UserSelect
          label="Select owner"
          selectId="vaultOwnerSelect"
          valueId={ownerId}
          onChangeId={(id) => {
            setOwnerId(id);
            setPhotos([]);
            setErr("");
          }}
        />

        {!canUse ? (
          <div className="notice" style={{ marginTop: 10 }}>
            Select a user to view and upload files.
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            onClick={refresh}
            disabled={!canUse || busy}
          >
            {busy ? "Working…" : "Refresh"}
          </button>
        </div>
      </div>

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

        <div className="small" style={{ marginTop: 8 }}>
          Uploaded files are stored on the hub server and associated to the
          selected owner.
        </div>
      </div>

      <div className="card compact" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "center" }}>
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
        </div>

        <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
          <label
            className="label"
            htmlFor={sliderId}
            style={{ marginBottom: 0 }}
          >
            Preview size
          </label>
          <input
            id={sliderId}
            type="range"
            min="140"
            max="420"
            step="10"
            value={thumbWidth}
            onChange={(e) => setThumbWidth(Number(e.target.value))}
            disabled={!canUse}
          />
          <div className="small">{thumbWidth}px</div>

          <div
            className="small"
            style={{ marginLeft: "auto" }}
            aria-live="polite"
          >
            Showing {view.length} of {photos.length}
          </div>
        </div>
      </div>

      <div className="card compact" style={{ marginTop: 12 }}>
        {!canUse ? (
          <div className="small">(select an owner to view files)</div>
        ) : view.length === 0 ? (
          <div className="small">(no files match)</div>
        ) : (
          <div className="list">
            {view.map((p) => {
              const img = isImageFilename(p.original_name);
              const downloadUrl = api.photoDownloadUrl(p.id);

              // We don't have a "view" endpoint in the hub; download will still open in a new tab for images.
              return (
                <div className="item" key={p.id}>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                    }}
                  >
                    {img ? (
                      <div style={{ width: thumbWidth }}>
                        <img
                          src={downloadUrl}
                          alt={p.original_name}
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
                      <div style={{ fontWeight: 800 }}>{p.original_name}</div>
                      <div className="small">
                        id={p.id} • {p.size_bytes} bytes • {p.created_at}
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <a href={downloadUrl} target="_blank" rel="noreferrer">
                          Download / open
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
