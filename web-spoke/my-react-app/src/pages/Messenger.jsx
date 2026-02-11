import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import UserSelect from "../components/UserSelect.jsx";

export default function Messenger() {
  const [meId, setMeId] = useState(null);
  const [themId, setThemId] = useState(null);

  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollSeconds, setPollSeconds] = useState(5);
  const [lastRefresh, setLastRefresh] = useState("");

  const inFlight = useRef(false);
  const bottomRef = useRef(null);

  const canUse = useMemo(() => {
    return !!meId && !!themId && meId !== themId;
  }, [meId, themId]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function refreshThread({ keepScroll = false } = {}) {
    if (!canUse) return;
    if (inFlight.current) return;

    inFlight.current = true;
    setErr("");
    setLoading(true);

    try {
      // Fetch both directions and merge/sort.
      const [ab, ba] = await Promise.all([
        api.listMessages({ sender_id: meId, recipient_id: themId }),
        api.listMessages({ sender_id: themId, recipient_id: meId }),
      ]);

      const all = [...(ab || []), ...(ba || [])].sort(
        (a, b) => (a.id ?? 0) - (b.id ?? 0),
      );

      setMsgs(all);
      setLastRefresh(new Date().toLocaleTimeString());

      if (!keepScroll) setTimeout(scrollToBottom, 0);
    } catch (e) {
      setErr(String(e?.message || e || "Failed to load thread"));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  async function send() {
    const body = text.trim();
    if (!canUse || !body) return;

    setErr("");

    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender_id: meId,
      recipient_id: themId,
      body,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };

    setMsgs((prev) => [...prev, optimistic]);
    setText("");
    setTimeout(scrollToBottom, 0);

    try {
      await api.sendMessage({ sender_id: meId, recipient_id: themId, body });
      await refreshThread();
    } catch (e) {
      setMsgs((prev) => prev.filter((m) => m.id !== tempId));
      setErr(String(e?.message || e || "Send failed"));
    }
  }

  // When selection changes, reset and refresh
  useEffect(() => {
    setMsgs([]);
    setLastRefresh("");
    if (canUse) refreshThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, themId]);

  // Polling loop
  useEffect(() => {
    if (!polling || !canUse) return;

    const secs = Number(pollSeconds);
    if (!Number.isFinite(secs) || secs <= 0) return;

    const id = window.setInterval(() => {
      refreshThread({ keepScroll: true });
    }, secs * 1000);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, pollSeconds, canUse, meId, themId]);

  const pollingId = "pollingToggle";
  const pollIntervalId = "pollInterval";
  const messageInputId = "messageInput";

  return (
    <section className="card" aria-label="Messenger">
      <h2 className="h2">Messenger</h2>

      <div className="row" style={{ alignItems: "flex-start", marginTop: 12 }}>
        <div className="card compact" style={{ flex: 1 }}>
          <h3 className="h3">Conversation</h3>

          <UserSelect
            label="Me (sender)"
            selectId="meSelect"
            valueId={meId}
            onChangeId={setMeId}
          />

          <UserSelect
            label="Chat with (recipient)"
            selectId="themSelect"
            valueId={themId}
            onChangeId={setThemId}
            disabledId={meId}
            enabled={!!meId}
          />

          {!canUse ? (
            <div className="notice" style={{ marginTop: 10 }}>
              Select two different users to start chatting.
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              onClick={() => refreshThread()}
              disabled={!canUse || loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>

            <div className="small" aria-live="polite">
              {lastRefresh ? `Last refresh: ${lastRefresh}` : ""}
            </div>
          </div>

          <div className="card compact" style={{ marginTop: 12 }}>
            <h3 className="h3">Auto-refresh</h3>

            <div className="row" style={{ alignItems: "center" }}>
              <div>
                <input
                  id={pollingId}
                  type="checkbox"
                  checked={polling}
                  onChange={(e) => setPolling(e.target.checked)}
                  disabled={!canUse}
                />
                <label
                  htmlFor={pollingId}
                  className="small"
                  style={{ marginLeft: 8 }}
                >
                  Enable polling
                </label>
              </div>

              <div>
                <label
                  htmlFor={pollIntervalId}
                  className="small"
                  style={{ marginRight: 8 }}
                >
                  Interval (seconds)
                </label>
                <input
                  id={pollIntervalId}
                  className="input"
                  style={{ width: 110 }}
                  value={pollSeconds}
                  onChange={(e) => setPollSeconds(e.target.value)}
                  disabled={!canUse || !polling}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card compact" style={{ flex: 2 }}>
          <h3 className="h3">Thread</h3>

          <div
            className="chatBox"
            aria-label="Message thread"
            aria-busy={loading ? "true" : "false"}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 12,
              height: 420,
              overflowY: "auto",
            }}
          >
            {msgs.length === 0 ? (
              <div className="small">(no messages)</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {msgs.map((m) => {
                  const mine = m.sender_id === meId;
                  const optimistic = m._optimistic;

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        justifyContent: mine ? "flex-end" : "flex-start",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "70%",
                          padding: "10px 12px",
                          borderRadius: 14,
                          border: "1px solid var(--border)",
                          background: mine
                            ? "rgba(122, 162, 255, 0.16)"
                            : "rgba(255, 255, 255, 0.04)",
                          color: "var(--text)",
                          opacity: optimistic ? 0.65 : 1,
                        }}
                      >
                        <div className="small">
                          {typeof m.id === "string" ? "sending…" : `id=${m.id}`}{" "}
                          • {m.created_at}
                        </div>
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                          {m.body}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 10, alignItems: "stretch" }}>
            <label className="visuallyHidden" htmlFor={messageInputId}>
              Message text
            </label>

            <input
              id={messageInputId}
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={canUse ? "Type message…" : "Select users to type…"}
              style={{ flex: 1 }}
              disabled={!canUse}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />

            <button
              type="button"
              className="btn primary"
              onClick={send}
              disabled={!canUse}
            >
              Send
            </button>
          </div>

          {err ? (
            <div className="error" role="alert" style={{ marginTop: 12 }}>
              {err}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
