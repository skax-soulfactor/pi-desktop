import { useEffect, useState } from "react";
import type { ConnectionState } from "../shared/api";
import { connectionLabel } from "./connection-label";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting" });

  useEffect(() => {
    void window.piAgent.connectionState().then(setConnection);
    return window.piAgent.onConnection(setConnection);
  }, []);

  const label = connectionLabel(connection);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Pi Desktop Agent</span>
        <span className="spacer" />
        <span className={`badge ${label.tone}`}>{label.text}</span>
      </header>
    </div>
  );
}
