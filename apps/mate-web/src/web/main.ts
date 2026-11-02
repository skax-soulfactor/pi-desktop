import { bootWebApp } from "@pi-desktop/web-shell/client";

// 휴대폰 웹 버전임을 화면 코드에 알린다. 휴대폰 전용 동작은 이 표시가 있을 때만 켠다 (clipboard-images.ts의 isWebClient, CSS의 :root[data-client="web"])
document.documentElement.dataset.client = "web";

/**
 * Pi Desktop Mate 웹 화면의 시작점 (설계 DESIGN.md §5.11).
 * 연결이 열리면 Mate의 preload(window.mate를 둔다)와 화면을 그대로 불러온다. "electron"은 web-shell 대체 모듈로 묶인다.
 */
bootWebApp({
  title: "Pi Mate",
  urlCommand: "pi-web mate url",
  // 첫 화면의 "Pi Desktop Mate" 옆에 웹앱 버전
  versionTarget: ".top .brand",
  loadApp: async () => {
    await import("../../../mate/src/preload/index");
    await import("../../../mate/src/renderer/main");
    // 앱 화면 CSS 뒤에 두어야 같은 선택자를 덮는다
    await import("./web.css");
  },
});
