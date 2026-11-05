import { shell } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { focusRunningApp } from "./focus-window";

/**
 * Pi Desktop 찾기·열기. 0.7.0부터 Agent는 Pi Desktop 안의 작업 공간이라, 이것은 옛 단독 Agent 앱의 징검다리(index.ts)만 쓴다
 * ("Pi Desktop으로 합쳐졌습니다" → Pi Desktop 열기). Agent 작업 공간의 Pi 관리는 Pi 작업 공간이 연다 (agent-main.ts openPiManager).
 */
export const PI_DESKTOP_REPO = "soulfactorx/pi-desktop";

/**
 * 설치된 Pi Desktop 실행 파일(macOS는 .app). 기본 설치 위치만 본다.
 * Windows 사용자 설치는 %LOCALAPPDATA%\Programs\<productName>(실제로 "Pi Desktop")에 깔린다.
 * electron-builder 설정에 따라 패키지 이름(pi-desktop) 폴더일 수도 있어 둘 다 본다.
 */
export function findPiDesktop(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates: string[] = [];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(join(env.LOCALAPPDATA, "Programs", "Pi Desktop", "Pi Desktop.exe"));
      candidates.push(join(env.LOCALAPPDATA, "Programs", "pi-desktop", "Pi Desktop.exe"));
    }
    if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, "Pi Desktop", "Pi Desktop.exe"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/Pi Desktop.app", join(homedir(), "Applications", "Pi Desktop.app"));
  } else {
    candidates.push("/opt/Pi Desktop/pi-desktop", "/usr/bin/pi-desktop");
  }
  return candidates.find((path) => existsSync(path));
}

/**
 * Pi Desktop을 연다. 이미 떠 있으면 새로 띄우지 않고 그 창으로 포커스를 옮긴다
 * (Pi Desktop은 단일 인스턴스 처리가 없어 다시 열면 두 번째 창이 뜬다). 설치된 것을 찾지 못하면 false
 */
export async function openPiDesktop(): Promise<boolean> {
  if (await focusRunningApp("Pi Desktop", "pi-desktop")) return true;
  const path = findPiDesktop();
  if (!path) return false;
  const error = await shell.openPath(path);
  if (error) throw new Error(`Pi Desktop을 열지 못했습니다: ${error}`);
  return true;
}
