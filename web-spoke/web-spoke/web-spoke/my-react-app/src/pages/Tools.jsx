import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

const STATUSES = [
  "available",
  "checked_out",
  "needs_repair",
  "missing",
  "tagged_out",
];

const SHORT_TEXT_RE = /^[-A-Za-z0-9 .,_/#+()&'":]{1,120}$/;
const NOTES_RE = /^[\x20-\x7E\t\r\n]*$/; // printable ASCII + whitespace

function isSafeShortText(s) {
  const v = (s || "").trim();
  if (!v) return false;
  if (/[<>`]/.test(v)) return false;
  return SHORT_TEXT_RE.test(v);
}

function isSafeNotesText(s, { maxLen = 2000 } = {}) {
  const v = (s || "").trim();
  if (!v) return true; // optional
  if (v.length > maxLen) return false;
  // Block obvious HTML/script injection vectors. React escapes by default, but keep inputs clean.
  if (/[<>`]/.test(v)) return false;
  return NOTES_RE.test(v);
}

function isSafeOptionalShortText(s) {
  const v = (s || "").trim();
  if (!v) return true;
  return isSafeShortText(v);
}

function validateImageFile(file) {
  if (!file) return null;
  const maxBytes = 10 * 1024 * 1024; // 10MB
  if (!file.type?.startsWith("image/")) return "Please choose an image file.";
  if (file.size > maxBytes) return "Image is too large (max 10MB).";
  return null;
}

function normalize(s) {
  return (s || "").trim();
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function buildToolPatch(original, draft) {
  const patch = {};
  const fields = [
    "group_id",
    "name",
    "brand",
    "model",
    "location",
    "status",
    "notes",
  ];
  for (const f of fields) {
    const ov = original[f] ?? null;
    const dv = draft[f] ?? null;
    if (ov !== dv) patch[f] = dv;
  }
  return patch;
}

function Dialog({
  open,
  onClose,
  title,
  children,
  labelledById,
  headerRight = null,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open) {
      if (!el.open) el.showModal();

      // Move focus to the first focusable element for keyboard users.
      // (Native <dialog> doesn't guarantee focus placement across browsers.)
      requestAnimationFrame(() => {
        const first = el.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (first && typeof first.focus === "function") first.focus();
      });
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      style={{
        width: "min(920px, 96vw)",
        maxWidth: "96vw",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 0,
        background: "var(--surface)",
        color: "var(--text)",
      }}
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
        <h2 id={labelledById} style={{ margin: 0, fontSize: "1.05rem" }}>
          {title}
        </h2>

        <div style={{ marginLeft: "auto" }}>
          {headerRight ? (
            headerRight
          ) : (
            <button type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: 14 }}>{children}</div>

      <style>{`
        dialog::backdrop { background: rgba(0,0,0,0.55); }
        @media (max-width: 720px) {
          dialog {
            width: 96vw !important;
            height: 92vh !important;
          }
        }
      `}</style>
    </dialog>
  );
}

function ProminentButton({ onClick, children, title, variant = "primary" }) {
  const base = {
    height: 40,
    padding: "0 14px",
    borderRadius: 12,
    fontWeight: 700,
    border: "1px solid var(--border)",
    cursor: "pointer",
  };

  if (variant === "primary") {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{
          ...base,
          background: "var(--accent)",
          color: "#0b0c0f",
          borderColor: "transparent",
        }}
      >
        {children}
      </button>
    );
  }

  if (variant === "danger") {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className="danger"
        style={{ ...base }}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        ...base,
        background: "var(--surface)",
        color: "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

function groupLabel(tool, groupsById = {}) {
  if (tool.group_id == null) return "Ungrouped";
  const g = groupsById[tool.group_id];
  return g?.name || `Group ${tool.group_id}`;
}

function Pill({ text, tone = "default" }) {
  const bg =
    tone === "good"
      ? "rgba(90,230,200,0.15)"
      : tone === "warn"
        ? "rgba(255,200,90,0.15)"
        : tone === "bad"
          ? "rgba(255,90,106,0.14)"
          : "rgba(122,162,255,0.12)";
  const border =
    tone === "good"
      ? "rgba(90,230,200,0.35)"
      : tone === "warn"
        ? "rgba(255,200,90,0.35)"
        : tone === "bad"
          ? "rgba(255,90,106,0.35)"
          : "rgba(122,162,255,0.35)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        fontSize: 12,
        color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export default function Tools({ me }) {
  const [err, setErr] = useState("");

  const [groups, setGroups] = useState([]);
  const [tools, setTools] = useState([]);
  const [groupFilterId, setGroupFilterId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("group");

  const [groupsOpen, setGroupsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const [newToolOpen, setNewToolOpen] = useState(false);
  const [newTool, setNewTool] = useState({
    name: "",
    brand: "",
    model: "",
    location: "",
    status: "available",
    notes: "",
    group_id: null,
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState(null);
  const [selectedTool, setSelectedTool] = useState(null);
  const [toolDraft, setToolDraft] = useState(null);
  const [detailsHasChanges, setDetailsHasChanges] = useState(false);

  const [toolPhotos, setToolPhotos] = useState([]);
  const [photoTokens, setPhotoTokens] = useState({}); // photo_id -> token

  const uploadRef = useRef(null);

  const newToolFileRef = useRef(null);
  const [newToolPhotoFile, setNewToolPhotoFile] = useState(null);
  const [newToolPhotoPreviewUrl, setNewToolPhotoPreviewUrl] = useState("");
  const [newToolSaving, setNewToolSaving] = useState(false);

  // Preview for the optional "new tool" photo (local, before upload)
  useEffect(() => {
    if (!newToolPhotoFile) {
      if (newToolPhotoPreviewUrl) URL.revokeObjectURL(newToolPhotoPreviewUrl);
      setNewToolPhotoPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(newToolPhotoFile);
    // Revoke old preview URL if present
    if (newToolPhotoPreviewUrl) URL.revokeObjectURL(newToolPhotoPreviewUrl);
    setNewToolPhotoPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newToolPhotoFile]);

  const groupsById = useMemo(() => {
    const out = {};
    for (const g of groups) out[g.id] = g;
    return out;
  }, [groups]);

  async function loadAll() {
    const [gs, ts] = await Promise.all([api.listToolGroups(), api.listTools()]);
    setGroups(Array.isArray(gs) ? gs : []);
    setTools(Array.isArray(ts) ? ts : []);
  }

  async function loadSelectedTool(toolId) {
    const t = await api.getTool(toolId);
    setSelectedTool(t);
    setToolDraft(t ? { ...t } : null);
    setDetailsHasChanges(false);
  }

  async function loadSelectedToolPhotos(toolId) {
    const list = await api.listToolPhotos(toolId);
    const arr = Array.isArray(list) ? list : [];
    setToolPhotos(arr);

    // issue short-lived tokens (only needed if you view as non-owner; safe anyway)
    const tokenMap = {};
    for (const tp of arr) {
      try {
        const issued = await api.issuePhotoToken(tp.photo_id);
        if (issued?.token) tokenMap[tp.photo_id] = issued.token;
      } catch {
        // token may fail for owners depending on server config; ignore
      }
    }
    setPhotoTokens(tokenMap);
  }

  async function openDetails(toolId) {
    setErr("");
    setSelectedToolId(toolId);
    setDetailsOpen(true);

    try {
      await loadSelectedTool(toolId);
      await loadSelectedToolPhotos(toolId);
    } catch (e) {
      setErr(String(e?.message || e || "Load tool failed"));
    }
  }

  useEffect(() => {
    if (!me) return;
    loadAll().catch((e) => setErr(String(e?.message || e || "Load failed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (!detailsOpen) {
      setSelectedToolId(null);
      setSelectedTool(null);
      setToolDraft(null);
      setDetailsHasChanges(false);
      setToolPhotos([]);
      setPhotoTokens({});
    }
  }, [detailsOpen]);

  // details change tracking
  useEffect(() => {
    if (!selectedTool || !toolDraft) {
      setDetailsHasChanges(false);
      return;
    }
    const patch = buildToolPatch(selectedTool, toolDraft);
    setDetailsHasChanges(Object.keys(patch).length > 0);
  }, [selectedTool, toolDraft]);

  async function saveDetails() {
    if (!selectedTool || !toolDraft) return;

    // validate
    const name = normalize(toolDraft.name);
    if (!name) {
      setErr("Tool name is required.");
      return;
    }
    if (!isSafeShortText(name)) {
      setErr("Tool name has unsupported characters.");
      return;
    }
    if (!STATUSES.includes(normalize(toolDraft.status))) {
      setErr("Status is invalid.");
      return;
    }
    if (!isSafeOptionalShortText(toolDraft.brand)) {
      setErr("Brand has unsupported characters.");
      return;
    }
    if (!isSafeOptionalShortText(toolDraft.model)) {
      setErr("Model has unsupported characters.");
      return;
    }
    if (!isSafeOptionalShortText(toolDraft.location)) {
      setErr("Location has unsupported characters.");
      return;
    }
    if (!isSafeNotesText(toolDraft.notes, { maxLen: 2000 })) {
      setErr("Notes contains unsupported characters or is too long.");
      return;
    }

    const patch = buildToolPatch(selectedTool, {
      ...toolDraft,
      group_id: toolDraft.group_id === "" ? null : (toolDraft.group_id ?? null),
      name,
      brand: normalize(toolDraft.brand) || null,
      model: normalize(toolDraft.model) || null,
      location: normalize(toolDraft.location) || null,
      notes: normalize(toolDraft.notes) || null,
      status: normalize(toolDraft.status) || "available",
    });

    if (Object.keys(patch).length === 0) return;

    setErr("");
    try {
      await api.updateTool(selectedTool.id, patch);
      await loadAll();
      await loadSelectedTool(selectedTool.id);
    } catch (e) {
      setErr(String(e?.message || e || "Save failed"));
    }
  }

  async function deleteSelectedTool() {
    if (!selectedTool) return;
    const ok = window.confirm(
      `Delete tool "${selectedTool.name}"?\n\nThis will unlink tool photos (does not delete photos from Vault).`,
    );
    if (!ok) return;

    setErr("");
    try {
      await api.deleteTool(selectedTool.id);
      setDetailsOpen(false);
      setSelectedToolId(null);
      setToolPhotos([]);
      setPhotoTokens({});
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Delete tool failed"));
    }
  }

  // group management
  async function createGroup() {
    const name = normalize(newGroupName);
    if (!name) return;

    if (!isSafeShortText(name)) {
      setErr(
        "Group name has unsupported characters. Use letters/numbers and common punctuation only (no < >).",
      );
      return;
    }

    setErr("");

    try {
      await api.createToolGroup({ name });
      setNewGroupName("");
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Create group failed"));
    }
  }

  async function deleteGroup(groupId) {
    const g = groupsById[groupId];
    const ok = window.confirm(
      `Delete group "${g?.name || groupId}"?\n\nTools in this group become Ungrouped.`,
    );
    if (!ok) return;

    setErr("");
    try {
      await api.deleteToolGroup(groupId);
      if (String(groupFilterId) === String(groupId)) setGroupFilterId("");
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Delete group failed"));
    }
  }

  // new tool flow
  function openNewTool() {
    setNewTool({
      name: "",
      brand: "",
      model: "",
      location: "",
      status: "available",
      notes: "",
      group_id: groupFilterId ? Number(groupFilterId) : null,
    });
    setNewToolPhotoFile(null);
    setNewToolOpen(true);
  }

  async function createTool() {
    if (newToolSaving) return;
    const name = normalize(newTool.name);
    if (!name) {
      setErr("Tool name is required.");
      return;
    }

    if (!isSafeShortText(name)) {
      setErr(
        "Tool name has unsupported characters. Use letters/numbers and common punctuation only (no < >).",
      );
      return;
    }

    if (!isSafeOptionalShortText(newTool.brand)) {
      setErr("Brand has unsupported characters.");
      return;
    }
    if (!isSafeOptionalShortText(newTool.model)) {
      setErr("Model has unsupported characters.");
      return;
    }
    if (!isSafeOptionalShortText(newTool.location)) {
      setErr("Location has unsupported characters.");
      return;
    }
    if (!STATUSES.includes(normalize(newTool.status))) {
      setErr("Status is invalid.");
      return;
    }
    if (!isSafeNotesText(newTool.notes, { maxLen: 2000 })) {
      setErr(
        "Notes contains unsupported characters or is too long (max 2000).",
      );
      return;
    }

    const photoErr = validateImageFile(newToolPhotoFile);
    if (photoErr) {
      setErr(photoErr);
      return;
    }

    const payload = {
      group_id: newTool.group_id ?? null,
      name,
      brand: normalize(newTool.brand) || null,
      model: normalize(newTool.model) || null,
      location: normalize(newTool.location) || null,
      status: normalize(newTool.status) || "available",
      notes: normalize(newTool.notes) || null,
    };

    setErr("");
    setNewToolSaving(true);
    try {
      const created = await api.createTool(payload);
      const toolId = created?.id;

      if (toolId && newToolPhotoFile) {
        const uploaded = await api.uploadPhoto(newToolPhotoFile);
        const photoId = uploaded?.id;
        if (photoId) {
          await api.attachToolPhoto(toolId, {
            photo_id: photoId,
            is_primary: true,
          });
        }
      }

      await loadAll();
      setNewToolOpen(false);
      setNewToolPhotoFile(null);

      if (created?.id) openDetails(created.id);
    } catch (e) {
      setErr(String(e?.message || e || "Create tool failed"));
    } finally {
      setNewToolSaving(false);
    }
  }

  // photos (details)
  async function uploadAndAttachPhoto(file, { makePrimary = false } = {}) {
    if (!selectedTool) return;

    const photoErr = validateImageFile(file);
    if (photoErr) {
      setErr(photoErr);
      return;
    }

    setErr("");

    try {
      const uploaded = await api.uploadPhoto(file);
      const photoId = uploaded?.id;
      if (!photoId) throw new Error("Upload did not return photo id");

      await api.attachToolPhoto(selectedTool.id, {
        photo_id: photoId,
        is_primary: makePrimary,
      });

      await loadSelectedToolPhotos(selectedTool.id);
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Attach photo failed"));
    }
  }

  async function removeToolPhoto(tp) {
    if (!selectedTool) return;
    const ok = window.confirm(
      "Remove this photo from the tool?\n\nThis does NOT delete the photo from Vault.",
    );
    if (!ok) return;

    setErr("");
    try {
      await api.deleteToolPhoto(selectedTool.id, tp.id);
      await loadSelectedToolPhotos(selectedTool.id);
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Remove photo failed"));
    }
  }

  async function setPrimary(tp) {
    if (!selectedTool) return;
    setErr("");

    try {
      await api.setToolPhotoPrimary(selectedTool.id, tp.id);
      await loadSelectedToolPhotos(selectedTool.id);
      await loadAll();
    } catch (e) {
      setErr(String(e?.message || e || "Set primary failed"));
    }
  }

  const groupedTools = useMemo(() => {
    const list = Array.isArray(tools) ? tools : [];

    if (groupBy === "none") return [{ key: "All Tools", items: list }];

    const getKey = (t) => {
      if (groupBy === "status") return t.status || "unknown";
      if (groupBy === "location") return t.location || "Unspecified";
      if (groupBy === "group") return groupLabel(t);
      return "All Tools";
    };

    const map = new Map();
    for (const t of list) {
      const k = getKey(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }

    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [tools, groupBy, groupsById]);

  if (!me) {
    return (
      <div style={{ padding: 12 }}>
        <h2>Tools</h2>
        <div className="small" role="alert">
          Log in with your API key to use Tools.
        </div>
      </div>
    );
  }

  const detailsHeaderRight = (
    <button
      type="button"
      onClick={() => {
        if (detailsHasChanges) {
          const ok = window.confirm(
            "You have unsaved changes.\n\nClose without saving?",
          );
          if (!ok) return;
        }
        setDetailsOpen(false);
      }}
    >
      Close
    </button>
  );

  function onUploadClick() {
    uploadRef.current?.click();
  }

  function onUploadFile(file) {
    uploadAndAttachPhoto(file, { makePrimary: toolPhotos.length === 0 });
  }

  function setField(field, value) {
    setToolDraft((d) => ({ ...(d || {}), [field]: value }));
  }

  function statusTone(s) {
    if (s === "available") return "good";
    if (s === "checked_out") return "warn";
    if (s === "needs_repair") return "warn";
    if (s === "missing") return "bad";
    if (s === "tagged_out") return "bad";
    return "default";
  }

  const details = selectedTool ? (
    <div>
      <div className="grid2">
        <div className="card" style={{ padding: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>Details</h3>
            <div style={{ marginLeft: "auto" }}>
              <Pill
                text={(toolDraft?.status || "").replaceAll("_", " ") || "—"}
                tone={statusTone(toolDraft?.status)}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="label" htmlFor="tool-name">
              Name
            </label>
            <input
              id="tool-name"
              value={toolDraft?.name || ""}
              onChange={(e) => setField("name", e.target.value)}
            />
          </div>

          <div
            className="formGridTwo"
          >
            <div>
              <label className="label" htmlFor="tool-group">
                Group
              </label>
              <select
                id="tool-group"
                value={toolDraft?.group_id ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setField("group_id", v ? Number(v) : null);
                }}
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="tool-status">
                Status
              </label>
              <select
                id="tool-status"
                value={toolDraft?.status || "available"}
                onChange={(e) => setField("status", e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="formGridTwo"
          >
            <div>
              <label className="label" htmlFor="tool-brand">
                Brand
              </label>
              <input
                id="tool-brand"
                value={toolDraft?.brand || ""}
                onChange={(e) => setField("brand", e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="label" htmlFor="tool-model">
                Model
              </label>
              <input
                id="tool-model"
                value={toolDraft?.model || ""}
                onChange={(e) => setField("model", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="tool-location">
              Location
            </label>
            <input
              id="tool-location"
              value={toolDraft?.location || ""}
              onChange={(e) => setField("location", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="label" htmlFor="tool-notes">
              Notes
            </label>
            <textarea
              id="tool-notes"
              rows={6}
              value={toolDraft?.notes || ""}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!detailsHasChanges) return;
                const ok = window.confirm("Discard your changes?");
                if (!ok) return;
                setToolDraft(selectedTool ? { ...selectedTool } : null);
              }}
              disabled={!detailsHasChanges}
            >
              Reset
            </button>

            <ProminentButton
              onClick={saveDetails}
              variant="primary"
              title="Save changes"
            >
              Save
            </ProminentButton>

            <ProminentButton
              onClick={deleteSelectedTool}
              variant="danger"
              title="Delete tool"
            >
              Delete
            </ProminentButton>
          </div>

          <div className="small" style={{ marginTop: 10 }}>
            Created: {formatDate(selectedTool.created_at)} <br />
            Updated: {formatDate(selectedTool.updated_at)}
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>Photos</h3>
            <div style={{ marginLeft: "auto" }}>
              <button type="button" onClick={onUploadClick}>
                Upload & attach
              </button>
            </div>
          </div>

          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onUploadFile(f);
            }}
          />
          <div className="small">Stored in Vault; linked to this tool.</div>

          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            {toolPhotos.map((tp) => {
              const token = photoTokens[tp.photo_id] || "";
              const url = api.photoViewUrl(tp.photo_id, token);

              return (
                <div
                  key={tp.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "var(--surface-2)",
                  }}
                >
                  <a href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt={tp.is_primary ? "Primary tool photo" : "Tool photo"}
                      style={{
                        width: "100%",
                        height: 140,
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  </a>

                  <div style={{ padding: 10 }}>
                    <div className="small">
                      {tp.is_primary ? (
                        <strong>Primary</strong>
                      ) : (
                        <span>Not primary</span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setPrimary(tp)}
                        disabled={tp.is_primary}
                      >
                        Make primary
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeToolPhoto(tp)}
                      >
                        Remove link
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {toolPhotos.length === 0 ? (
              <div className="small">No photos yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="small">Loading…</div>
  );

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Tools</h2>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <ProminentButton onClick={openNewTool} variant="primary">
            New tool
          </ProminentButton>
          <ProminentButton
            onClick={() => setGroupsOpen(true)}
            variant="secondary"
          >
            Manage groups
          </ProminentButton>
        </div>
      </div>

      {err ? (
        <div className="small" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label className="label" htmlFor="filter-group">
                Filter by group
              </label>
              <select
                id="filter-group"
                value={groupFilterId}
                onChange={(e) => setGroupFilterId(e.target.value)}
              >
                <option value="">All</option>
                <option value="__ungrouped__">Ungrouped only</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              <label className="label" htmlFor="filter-status">
                Filter by status
              </label>
              <select
                id="filter-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: 2, minWidth: 240 }}>
              <label className="label" htmlFor="filter-search">
                Search
              </label>
              <input
                id="filter-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, brand, model, location, notes…"
              />
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              <label className="label" htmlFor="group-by">
                Group view
              </label>
              <select
                id="group-by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="group">By group</option>
                <option value="status">By status</option>
                <option value="location">By location</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        {tools ? (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {groupedTools.map((bucket) => (
              <div key={bucket.key} className="card" style={{ padding: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>{bucket.key}</h3>
                  <div className="small" style={{ marginLeft: "auto" }}>
                    {bucket.items.length} item
                    {bucket.items.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="tableWrap" style={{ marginTop: 10 }}>
                  <table className="table responsiveStack">
                    <thead>
                      <tr>
                        <th align="left">Name</th>
                        <th align="left">Status</th>
                        <th align="left">Location</th>
                        <th align="left">Updated</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.items.map((t) => (
                        <tr key={t.id}>
                          <td data-label="Name">{t.name}</td>
                          <td data-label="Status">
                            {(t.status || "").replaceAll("_", " ")}
                          </td>
                          <td data-label="Location">
                            {t.location || <span className="muted">—</span>}
                          </td>
                          <td data-label="Updated">{formatDate(t.updated_at)}</td>
                          <td data-label="Action" style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => openDetails(t.id)}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}

                      {bucket.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="small">
                            No tools.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Groups dialog */}
      <Dialog
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        title="Tool groups"
        labelledById="dlg-groups"
      >
        <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div style={{ flex: 1 }}>
            <label className="label" htmlFor="new-group-name">
              New group name
            </label>
            <input
              id="new-group-name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Woodworking"
            />
          </div>
          <button type="button" onClick={createGroup}>
            Create group
          </button>
        </div>

        <div className="tableWrap" style={{ marginTop: 14 }}>
          <table className="table responsiveStack">
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td data-label="Name">{g.name}</td>
                  <td data-label="Created">{formatDate(g.created_at)}</td>
                  <td data-label="Action" style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteGroup(g.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {groups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="small">
                    No groups yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Dialog>

      {/* New tool dialog */}
      <Dialog
        open={newToolOpen}
        onClose={() => setNewToolOpen(false)}
        title="New tool"
        labelledById="dlg-new-tool"
      >
        <div className="formGridAuto">
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="label" htmlFor="nt-name">
              Name
            </label>
            <input
              id="nt-name"
              value={newTool.name}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, name: e.target.value }))
              }
              placeholder="Required"
            />
          </div>

          <div>
            <label className="label" htmlFor="nt-group">
              Group
            </label>
            <select
              id="nt-group"
              value={newTool.group_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setNewTool((t) => ({ ...t, group_id: v ? Number(v) : null }));
              }}
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="nt-status">
              Status
            </label>
            <select
              id="nt-status"
              value={newTool.status}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, status: e.target.value }))
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="nt-brand">
              Brand
            </label>
            <input
              id="nt-brand"
              value={newTool.brand}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, brand: e.target.value }))
              }
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="label" htmlFor="nt-model">
              Model
            </label>
            <input
              id="nt-model"
              value={newTool.model}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, model: e.target.value }))
              }
              placeholder="Optional"
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label className="label" htmlFor="nt-location">
              Location
            </label>
            <input
              id="nt-location"
              value={newTool.location}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, location: e.target.value }))
              }
              placeholder="Optional"
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label className="label" htmlFor="nt-notes">
              Notes
            </label>
            <textarea
              id="nt-notes"
              className="input"
              rows={4}
              value={newTool.notes}
              onChange={(e) =>
                setNewTool((t) => ({ ...t, notes: e.target.value }))
              }
              placeholder="Anything useful…"
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => newToolFileRef.current?.click()}
              >
                Upload photo (optional)
              </button>
              <input
                ref={newToolFileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  e.target.value = "";

                  if (!f) {
                    setNewToolPhotoFile(null);
                    return;
                  }

                  const photoErr = validateImageFile(f);
                  if (photoErr) {
                    setErr(photoErr);
                    setNewToolPhotoFile(null);
                    return;
                  }

                  setErr("");
                  setNewToolPhotoFile(f);
                }}
              />
              <div className="small">
                {newToolPhotoFile
                  ? `Selected: ${newToolPhotoFile.name}`
                  : "No photo selected."}
              </div>
            </div>

            {newToolPhotoPreviewUrl ? (
              <div style={{ marginTop: 10 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  Preview (will be saved to Vault and linked as primary)
                </div>
                <img
                  src={newToolPhotoPreviewUrl}
                  alt="Selected tool photo preview"
                  className="toolPhotoPreview"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              setNewToolOpen(false);
              setNewToolPhotoFile(null);
            }}
            disabled={newToolSaving}
          >
            Cancel
          </button>
          <button type="button" onClick={createTool} disabled={newToolSaving}>
            {newToolSaving ? "Creating…" : "Create tool"}
          </button>
        </div>
      </Dialog>

      {/* Details dialog */}
      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={selectedTool ? `Tool: ${selectedTool.name}` : "Tool"}
        labelledById="dlg-tool-details"
        headerRight={detailsHeaderRight}
      >
        {details}
      </Dialog>
    </div>
  );
}
