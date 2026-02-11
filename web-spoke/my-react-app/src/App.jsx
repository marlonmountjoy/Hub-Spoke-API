import React, { useState } from "react";
import AuthBar from "./components/AuthBar.jsx";
import Messenger from "./pages/Messenger.jsx";
import Vault from "./pages/Vault.jsx";

export default function App() {
  const [tab, setTab] = useState("messenger");

  const isMessenger = tab === "messenger";
  const isVault = tab === "vault";

  function onKeyDownTabs(e) {
    // Basic arrow-key tab navigation (WCAG-friendly)
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

    e.preventDefault();
    if (isMessenger) setTab("vault");
    else setTab("messenger");
  }

  return (
    <div className="container">
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <header aria-label="Application header">
        {/* No-auth mode: AuthBar is just "create user" + the copyable key modal */}
        <AuthBar />
      </header>

      <nav
        aria-label="Primary"
        className="nav"
        role="tablist"
        onKeyDown={onKeyDownTabs}
      >
        <button
          type="button"
          id="tab-messenger"
          role="tab"
          aria-selected={isMessenger}
          aria-controls="panel-messenger"
          className={isMessenger ? "active" : ""}
          onClick={() => setTab("messenger")}
        >
          Messenger
        </button>

        <button
          type="button"
          id="tab-vault"
          role="tab"
          aria-selected={isVault}
          aria-controls="panel-vault"
          className={isVault ? "active" : ""}
          onClick={() => setTab("vault")}
        >
          Vault
        </button>
      </nav>

      <main id="main" tabIndex={-1} aria-label="Main content">
        {isMessenger ? (
          <section
            id="panel-messenger"
            role="tabpanel"
            aria-labelledby="tab-messenger"
          >
            {/* No-auth: Messenger handles selecting sender/recipient internally */}
            <Messenger />
          </section>
        ) : (
          <section id="panel-vault" role="tabpanel" aria-labelledby="tab-vault">
            {/* No-auth: Vault handles selecting the owner internally */}
            <Vault />
          </section>
        )}
      </main>
    </div>
  );
}
