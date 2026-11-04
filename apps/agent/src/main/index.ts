import { app, dialog, shell } from "electron";
import { findPiDesktop, openPiDesktop, PI_DESKTOP_REPO } from "./pi-desktop";

/**
 * 징검다리 Pi Desktop Agent 0.7.0 (설계 DESIGN-ONE-APP.md §9, D3).
 *
 * 0.7.0부터 Agent는 Pi Desktop 창 안의 작업 공간이다. 옛 단독 Agent 설치본은 이 버전으로 마지막 업데이트를 받고,
 * 열면 "Pi Desktop으로 합쳐졌습니다"를 보인 뒤 Pi Desktop을 열거나(있으면) 내려받을 곳을 연다. 스스로 지우지는 않는다.
 * 업데이트 확인은 하지 않는다 (이 뒤로 agent*.yml을 올리지 않는다).
 *
 * Agent의 본체(agent-main.ts)·화면(renderer)·메뉴(app-menu.ts)는 Pi Desktop이 그대로 쓴다.
 */
app.whenReady().then(async () => {
  // Windows 작업 표시줄·알림의 앱 식별자 (설치 프로그램의 appId와 같다)
  app.setAppUserModelId("dev.pi-desktop.agent");
  const desktop = findPiDesktop();
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Pi Desktop Agent",
    message: "Pi Desktop Agent는 Pi Desktop으로 합쳐졌습니다",
    detail: [
      "0.7.0부터 Agent는 Pi Desktop 창 왼쪽 막대의 Agent 작업 공간입니다.",
      "대화·기억·스킬·예약 작업 등 데이터(~/.pi-desktop-agent)와 지금 호스트·SSH 호스트 설정은 그대로 이어집니다.",
      "",
      "이 앱은 더 업데이트되지 않습니다. 확인한 뒤 지워도 됩니다 (Windows: 설정 → 앱).",
      ...(desktop ? [] : ["", "이 PC에서 Pi Desktop을 찾지 못했습니다. 내려받아 설치하세요."]),
    ].join("\n"),
    buttons: [desktop ? "Pi Desktop 열기" : "Pi Desktop 내려받기", "닫기"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    if (desktop) await openPiDesktop();
    else await shell.openExternal(`https://github.com/${PI_DESKTOP_REPO}/releases/latest`);
  }
  app.quit();
});

app.on("window-all-closed", () => undefined);
