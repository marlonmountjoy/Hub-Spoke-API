import React, { useState } from "react";
import AuthBar from "./components/AuthBar.jsx";
import Messenger from "./pages/Messenger.jsx";
import Vault from "./pages/Vault.jsx";
import Tools from "./pages/Tools.jsx";
import ApiKeys from "./pages/ApiKeys.jsx";

export default function App() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("messenger");

  const isMessenger = tab === "messenger";
  const isVault = tab === "vault";
  const isTools = tab === "tools";
  const isApiKeys = tab === "apiKeys";

  function onKeyDownTabs(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();

    const order = ["messenger", "vault", "tools", "apiKeys"];
    const i = order.indexOf(tab);
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (i + dir + order.length) % order.length;
    setTab(order[next]);
  }

  return (
    <div className="container">
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <header aria-label="Application header">
        <AuthBar onAuthChange={setMe} />
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
          aria-current={isMessenger ? "page" : undefined}
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
          aria-current={isVault ? "page" : undefined}
          onClick={() => setTab("vault")}
        >
          Vault
        </button>

        <button
          type="button"
          id="tab-tools"
          role="tab"
          aria-selected={isTools}
          aria-controls="panel-tools"
          className={isTools ? "active" : ""}
          aria-current={isTools ? "page" : undefined}
          onClick={() => setTab("tools")}
        >
          Tools
        </button>

        <button
          type="button"
          id="tab-apiKeys"
          role="tab"
          aria-selected={isApiKeys}
          aria-controls="panel-apiKeys"
          className={isApiKeys ? "active" : ""}
          aria-current={isApiKeys ? "page" : undefined}
          onClick={() => setTab("apiKeys")}
        >
          API Keys
        </button>
      </nav>

      <main id="main" tabIndex={-1} aria-label="Main content">
        {isMessenger ? (
          <section
            id="panel-messenger"
            role="tabpanel"
            aria-labelledby="tab-messenger"
          >
            <Messenger me={me} />
          </section>
        ) : null}

        {isVault ? (
          <section id="panel-vault" role="tabpanel" aria-labelledby="tab-vault">
            <Vault me={me} />
          </section>
        ) : null}

        {isTools ? (
          <section id="panel-tools" role="tabpanel" aria-labelledby="tab-tools">
            <Tools me={me} />
          </section>
        ) : null}

        {isApiKeys ? (
          <section
            id="panel-apiKeys"
            role="tabpanel"
            aria-labelledby="tab-apiKeys"
          >
            <ApiKeys me={me} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
