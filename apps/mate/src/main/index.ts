import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAutostart, isRunnerOnlyLaunch, linuxDesktopFile, RUNNER_ONLY_ARG, setAutostart } from "./autostart";
import { findPiDesktop, PI_DESKTOP_REPO } from "./pi-desktop-install";
import { openPiDesktop } from "./pi-setup";

/**
 * 징검다리 Pi Desktop Mate 0.7.0 (설계 DESIGN-ONE-APP.md §9, D3).
 *
 * 0.7.0부터 Mate는 Pi Desktop 창 안의 작업 공간이다. 옛 단독 Mate 설치본은 이 버전으로 마지막 업데이트를 받고:
 * - "로그인할 때 실행기 시작"을 켜 두었으면 자기 로그인 항목을 지우고, Pi Desktop이 이어받도록 표시를 남긴다
 * - 로그인할 때 띄운 실행이면 Pi Desktop이 있을 때 그것을 --mate-runner-only로 띄워 실행기를 확인하게 하고 끝난다
 * - 열면 "Pi Desktop으로 합쳐졌습니다"를 보이고 Pi Desktop을 열거나(있으면) 내려받을 곳을 연다. 스스로 지우지는 않는다
 * 업데이트 확인은 하지 않는다 (이 뒤로 mate*.yml을 올리지 않는다). 실행기는 그대로 돌고, Pi Desktop의 Mate 작업 공간이 붙는다.
 */

/** Pi Desktop의 workspaces.ts MATE_AUTOSTART_WISH와 같은 이름. Pi Desktop의 userData(appData/Pi Desktop)에 둔다 */
const AUTOSTART_WISH = "mate-autostart-wanted";

/** 이 앱의 로그인 항목인가 (Linux 자동 시작 파일은 Pi Desktop과 이름이 같아, 실행 파일로 가른다) */
function ownAutostart(): boolean {
  if (!getAutostart().enabled) return false;
  if (process.platform !== "linux") return true;
  try {
    const text = readFileSync(linuxDesktopFile(), "utf8");
    return text.includes(process.env.APPIMAGE || process.execPath);
  } catch {
    return false;
  }
}

async function handOverAutostart(): Promise<void> {
  if (!ownAutostart()) return;
  try {
    const desktopData = join(app.getPath("appData"), "Pi Desktop");
    mkdirSync(desktopData, { recursive: true });
    writeFileSync(join(desktopData, AUTOSTART_WISH), `${new Date().toISOString()}\n`, "utf8");
    await setAutostart(false);
  } catch {
    // 못 하면 다음 실행에 다시 한다
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId("dev.pi-desktop.mate");
  await handOverAutostart();
  const desktop = await findPiDesktop();

  if (isRunnerOnlyLaunch()) {
    // 로그인할 때: 이번 부팅에서도 시간표가 돌도록 Pi Desktop에 실행기 확인을 맡긴다 (창 없음)
    if (desktop && existsSync(desktop) && process.platform !== "darwin") {
      spawn(desktop, [RUNNER_ONLY_ARG], { detached: true, stdio: "ignore" }).unref();
    }
    app.quit();
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Pi Desktop Mate",
    message: "Pi Desktop Mate는 Pi Desktop으로 합쳐졌습니다",
    detail: [
      "0.7.0부터 Mate는 Pi Desktop 창 왼쪽 막대의 Mate 작업 공간입니다.",
      "임무·인박스·대화 등 데이터(~/.pi-desktop-mate)와 실행기는 그대로 이어집니다. 로그인할 때 실행기 시작도 Pi Desktop이 이어받습니다.",
      "",
      "이 앱은 더 업데이트되지 않습니다. 확인한 뒤 지워도 됩니다 (Windows: 설정 → 앱).",
      ...(desktop ? [] : ["", "이 PC에서 Pi Desktop을 찾지 못했습니다. 내려받아 설치하세요."]),
    ].join("\n"),
    buttons: [desktop ? "Pi Desktop 열기" : "Pi Desktop 내려받기", "닫기"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    if (desktop) await openPiDesktop().catch(() => undefined);
    else await shell.openExternal(`https://github.com/${PI_DESKTOP_REPO}/releases/latest`);
  }
  app.quit();
});

app.on("window-all-closed", () => undefined);
