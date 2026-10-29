import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// 채팅·도구 카드·확장 UI는 Pi Desktop의 컴포넌트를 쓰므로 스타일도 함께 가져온다 (설계 DESIGN-AGENT.md §2.3).
import "@desktop/renderer/styles.css";
import "./agent.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
