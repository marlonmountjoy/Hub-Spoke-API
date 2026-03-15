import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import UserSelect from "../components/UserSelect.jsx";

const MSG_RE = /^[\x20-\x7E\t\r\n]*$/;
const NULL_CHAR = String.fromCharCode(0);

function cleanMsg(s) {
  return String(s || "")
    .split(NULL_CHAR)
    .join("");
}

function isSafeMessage(s) {
  const v = cleanMsg(s).trim();
  if (!v) return false;
  if (v.length > 2000) return false;
  if (/[<>`]/.test(v)) return false;
  return MSG_RE.test(v);
}

export default function Messenger({ me }) {
  const [themId, setThemId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollSeconds, setPollSeconds] = useState(5);
  const [lastRefresh, setLastRefresh] = useState("");
  const [nameById, setNameById] = useState({});

  const inFlight = useRef(false);
  const bottomRef = useRef(null);
  const threadRef = useRef(null);
  const textareaRef = useRef(null);

  const canUse = useMemo(
    () => !!me && !!themId && me.id !== themId,
    [me, themId],
  );

  function scrollThreadToBottom(behavior = "smooth") {
    if (!threadRef.current) return;
    const el = threadRef.current;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  function autoSizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(next, 52)}px`;
  }

  async function refreshThread({ preserveScroll = true } = {}) {
    if (!me || !themId) return;
    if (inFlight.current) return;
    inFlight.current = true;

    const threadEl = threadRef.current;
    const wasNearBottom = threadEl
      ? threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 96
      : true;

    setErr("");
    setLoading(true);
    try {
      const list = await api.listMessages({ with_user_id: themId });
      setMsgs(Array.isArray(list) ? list.reverse() : []);
      setLastRefresh(new Date().toLocaleTimeString());

      if (!preserveScroll || wasNearBottom) {
        requestAnimationFrame(() =>
          scrollThreadToBottom(wasNearBottom ? "smooth" : "auto"),
        );
      }
    } catch (e) {
      setMsgs([]);
      setErr(String(e?.message || e || "Failed to load messages"));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    if (!me) {
      setThemId(null);
      setMsgs([]);
      setErr("");
      setPolling(false);
      return;
    }

    api
      .listUsersCached()
      .then((list) => {
        const map = {};
        (Array.isArray(list) ? list : []).forEach((u) => {
          map[u.id] = u.username;
        });
        setNameById(map);
      })
      .catch(() => setNameById({}));
  }, [me]);

  useEffect(() => {
    refreshThread({ preserveScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, themId]);

  useEffect(() => {
    if (!polling || !canUse) return;

    const ms = Math.max(2, Number(pollSeconds) || 5) * 1000;
    const t = setInterval(() => {
      refreshThread({ preserveScroll: true });
    }, ms);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, pollSeconds, canUse]);

  useEffect(() => {
    autoSizeTextarea();
  }, [text]);

  useEffect(() => {
    autoSizeTextarea();
    const onResize = () => autoSizeTextarea();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function send() {
    const body = cleanMsg(text);
    if (!canUse) return;

    if (!isSafeMessage(body)) {
      setErr("Message must be 1–2000 chars, no < >, and plain text only.");
      return;
    }

    setErr("");
    const trimmed = body.trim();
    const tempId = `temp_${Date.now()}`;

    const optimistic = {
      id: tempId,
      sender_id: me.id,
      recipient_id: themId,
      body: trimmed,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };

    setMsgs((prev) => [...prev, optimistic]);
    setText("");
    requestAnimationFrame(() => {
      autoSizeTextarea();
      scrollThreadToBottom("smooth");
    });

    try {
      await api.sendMessage({ recipient_id: themId, body: trimmed });
      await refreshThread({ preserveScroll: false });
    } catch (e) {
      setMsgs((prev) => prev.filter((m) => m.id !== tempId));
      setErr(String(e?.message || e || "Send failed"));
    }
  }

  function handleMessageKeyDown(e) {
    if (e.nativeEvent?.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      send();
    }
  }

  function handleComposerSubmit(e) {
    e.preventDefault();
    send();
  }

  function youLabel(id) {
    if (!id) return "Unknown";
    return nameById[id] || `User ${id}`;
  }

  if (!me) {
    return (
      <div className="pageSection messengerPage">
        <h2 style={{ margin: 0 }}>Messenger</h2>
        <div className="small" role="alert">
          Log in to use Messenger.
        </div>
      </div>
    );
  }

  return (
    <div className="pageSection messengerPage">
      <div className="pageTitleRow">
        <h2 style={{ margin: 0 }}>Messenger</h2>
        <div className="small toolbarMeta">
          {loading
            ? "Loading…"
            : lastRefresh
              ? `Last refresh: ${lastRefresh}`
              : null}
        </div>
      </div>

      {err ? (
        <div className="small" role="alert">
          {err}
        </div>
      ) : null}

      <div className="card compact messengerControlsCard">
        <div className="messengerToolbarGrid">
          <div className="messengerUserSelect">
            <UserSelect
              label="Chat with"
              selectId="them"
              valueId={themId}
              onChangeId={setThemId}
              disabledId={me.id}
              enabled={true}
            />
          </div>

          <div className="messengerPollField">
            <label className="label" htmlFor="pollSeconds">
              Poll (sec)
            </label>
            <input
              id="pollSeconds"
              className="input"
              value={pollSeconds}
              onChange={(e) => setPollSeconds(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="messengerToolbarActions">
            <button
              type="button"
              onClick={async () => {
                const next = !polling;
                setPolling(next);
                if (next) await refreshThread({ preserveScroll: true });
              }}
              title="Auto-refresh this thread"
              disabled={!canUse && !polling}
            >
              {polling ? "Stop polling" : "Start polling"}
            </button>
          </div>
        </div>
      </div>

      <div
        ref={threadRef}
        className="card compact messengerThreadCard"
        aria-label="Message thread"
      >
        {msgs.length === 0 ? (
          <div className="small">No messages yet.</div>
        ) : null}

        <div className="messengerThreadList">
          {msgs.map((m) => {
            const mine = m.sender_id === me.id;
            return (
              <div
                key={m.id}
                className={`messageBubble ${mine ? "mine" : "theirs"}`}
              >
                <div className="small" style={{ marginBottom: 6 }}>
                  <strong>{mine ? "You" : youLabel(m.sender_id)}</strong>{" "}
                  <span className="muted">•</span>{" "}
                  <span className="muted">
                    {m.created_at
                      ? new Date(m.created_at).toLocaleString()
                      : "—"}
                  </span>
                  {m._optimistic ? (
                    <span className="muted"> • sending…</span>
                  ) : null}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="card compact messengerComposerCard">
        <form className="messageComposerForm" onSubmit={handleComposerSubmit}>
          <label className="label" htmlFor="msg">
            Message
          </label>
          <textarea
            ref={textareaRef}
            id="msg"
            className="input messageTextarea"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDownCapture={handleMessageKeyDown}
            onKeyDown={handleMessageKeyDown}
            enterKeyHint="send"
            aria-keyshortcuts="Enter"
            placeholder={canUse ? "Type a message…" : "Select a user first…"}
            disabled={!themId || themId === me.id}
          />

          <div className="messageComposerActions" style={{ marginTop: 10 }}>
            <div className="small">
              Enter sends • Shift+Enter adds a new line
            </div>
            <button type="submit" disabled={!canUse}>
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
