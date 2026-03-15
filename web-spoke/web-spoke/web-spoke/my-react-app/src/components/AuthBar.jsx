import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const NULL_CHAR = String.fromCharCode(0);

function clean(s) {
  return (s || "").split(NULL_CHAR).join("").trim();
}

function isSafeUsername(s) {
  const v = clean(s);
  return USERNAME_RE.test(v);
}

function isSafePassword(s) {
  const v = String(s || "");

  if (!v) return false;
  if (v.length < 8 || v.length > 128) return false;
  if (v.indexOf(NULL_CHAR) !== -1) return false;

  return true;
}

export default function AuthBar({ onAuthChange }) {
  const [status, setStatus] = useState({ ok: null, time_utc: "" });

  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");

  function pushMe(next) {
    setMe(next);
    if (onAuthChange) onAuthChange(next);
  }

  useEffect(() => {
    api
      .health()
      .then((h) => setStatus(h))
      .catch(() => setStatus({ ok: null, time_utc: "" }));
  }, []);

  useEffect(() => {
    const t = api.getAccessToken();
    if (!t) return;

    api
      .me()
      .then((u) => {
        pushMe(u);
        setErr("");
      })
      .catch(() => {
        api.clearAccessToken();
        pushMe(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLogin() {
    setErr("");

    const username = clean(loginUsername);
    const password = loginPassword || "";

    if (!isSafeUsername(username)) {
      setErr(
        "Username must be 3–32 chars: letters, numbers, dot, underscore, dash.",
      );
      return;
    }
    if (!isSafePassword(password)) {
      setErr("Password must be 8–128 characters.");
      return;
    }

    try {
      await api.login(username, password);
      const u = await api.me();
      pushMe(u);
      setLoginPassword("");
    } catch (e) {
      api.clearAccessToken();
      pushMe(null);
      setErr(String(e?.message || e || "Login failed"));
    }
  }

  function doLogout() {
    api.logout();
    pushMe(null);
    setErr("");
  }

  async function doRegister() {
    setErr("");

    const username = clean(regUsername);
    const p1 = regPassword || "";
    const p2 = regPassword2 || "";

    if (!isSafeUsername(username)) {
      setErr(
        "Username must be 3–32 chars: letters, numbers, dot, underscore, dash.",
      );
      return;
    }
    if (!isSafePassword(p1) || !isSafePassword(p2)) {
      setErr("Password must be 8–128 characters.");
      return;
    }
    if (p1 !== p2) {
      setErr("Passwords do not match.");
      return;
    }

    try {
      await api.register(username, p1);
      await api.login(username, p1);
      const u = await api.me();
      pushMe(u);

      setRegUsername("");
      setRegPassword("");
      setRegPassword2("");
    } catch (e) {
      api.clearAccessToken();
      pushMe(null);
      setErr(String(e?.message || e || "Register failed"));
    }
  }

  const ok = status?.ok;
  const errId = err ? "auth-error" : undefined;

  return (
    <div className="card authCard">
      <div className="authShell">
        <div className="authBrand">
          <div
            aria-label={
              ok
                ? "Hub online"
                : ok === false
                  ? "Hub offline"
                  : "Hub status unknown"
            }
            title={
              ok
                ? "Hub online"
                : ok === false
                  ? "Hub offline"
                  : "Hub status unknown"
            }
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: ok
                ? "var(--accent-2)"
                : ok === false
                  ? "var(--danger)"
                  : "var(--muted)",
            }}
          />
          <div>
            <div style={{ fontWeight: 800 }}>Hub-Spoke</div>
            <div className="small">
              {status?.time_utc
                ? `Hub time (UTC): ${status.time_utc}`
                : "Health check…"}
            </div>
          </div>
        </div>

        <div className="authActions">
          {me ? (
            <div className="authPanel authLoggedIn">
              <div className="small">
                Signed in as <strong>{me.username}</strong>
              </div>
              <button type="button" onClick={doLogout}>
                Log out
              </button>
            </div>
          ) : (
            <>
              <form
                className="authPanel"
                onSubmit={(e) => {
                  e.preventDefault();
                  doLogin();
                }}
                aria-describedby={errId}
              >
                <div
                  className="small"
                  style={{ fontWeight: 800, marginBottom: 6 }}
                >
                  Log in
                </div>
                <div className="authInputs">
                  <label className="srOnly" htmlFor="login-username">
                    Login username
                  </label>
                  <input
                    id="login-username"
                    aria-label="Login username"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="username"
                    autoComplete="username"
                  />
                  <label className="srOnly" htmlFor="login-password">
                    Login password
                  </label>
                  <input
                    id="login-password"
                    aria-label="Login password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="password"
                    type="password"
                    autoComplete="current-password"
                  />
                  <button type="submit">Log in</button>
                </div>
              </form>

              <form
                className="authPanel"
                onSubmit={(e) => {
                  e.preventDefault();
                  doRegister();
                }}
                aria-describedby={errId}
              >
                <div
                  className="small"
                  style={{ fontWeight: 800, marginBottom: 6 }}
                >
                  Register
                </div>
                <div className="authInputs">
                  <label className="srOnly" htmlFor="reg-username">
                    Register username
                  </label>
                  <input
                    id="reg-username"
                    aria-label="Register username"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="username"
                    autoComplete="username"
                  />
                  <label className="srOnly" htmlFor="reg-password">
                    Register password
                  </label>
                  <input
                    id="reg-password"
                    aria-label="Register password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="password"
                    type="password"
                    autoComplete="new-password"
                  />
                  <label className="srOnly" htmlFor="reg-password2">
                    Confirm password
                  </label>
                  <input
                    id="reg-password2"
                    aria-label="Confirm password"
                    value={regPassword2}
                    onChange={(e) => setRegPassword2(e.target.value)}
                    placeholder="confirm"
                    type="password"
                    autoComplete="new-password"
                  />
                  <button type="submit">Register</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {err ? (
        <div
          id="auth-error"
          className="small"
          role="alert"
          aria-live="assertive"
          style={{ marginTop: 10 }}
        >
          {err}
        </div>
      ) : null}
    </div>
  );
}
