import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// 채팅·도구 카드·확장 UI는 Pi Desktop의 컴포넌트를 그대로 쓴다. 스타일은 Agent 화면에 맞춘 것을 따로 둔다
// (Agent 화면은 Pi Desktop 창 안에서도 iframe이라 CSS가 섞이지 않는다. DESIGN-ONE-APP.md §5)
import "./chat.css";
import "./agent.css";
import "./layout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
