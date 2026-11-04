import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./Shell";
import "./styles.css";
import { loadAppTunables } from "./app-tunables";

// 바꾼 앱 수치를 먼저 받아 둔다 (DESIGN-APPS.md §7). 못 받아도 기본값으로 그린다
void loadAppTunables().finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  ),
);
