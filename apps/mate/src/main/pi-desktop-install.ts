import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Pi Desktop 찾기·설치 파일 고르기 (설계 DESIGN-MATE.md §9 Pi 준비).
 *
 * Mate는 Pi를 설치·로그인하는 화면을 따로 만들지 않는다. Pi 관리는 Pi Desktop이 맡고,
 * Mate는 Pi Desktop을 쉽게 설치·열 수 있게 돕는다.
 */
export const PI_DESKTOP_REPO = "skax-soulfactor/pi-desktop";

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/**
 * Pi Desktop Latest 릴리스에서 이 OS용 설치 파일을 고른다.
 * 같은 저장소에 Mate 릴리스(Pi-Desktop-Mate-…)도 있으므로 Mate 파일은 고르지 않는다.
 */
export function pickPiDesktopAsset(assets: ReleaseAsset[], platform: NodeJS.Platform, arch: string): ReleaseAsset | undefined {
  const desktop = assets.filter((a) => /^Pi-Desktop-/.test(a.name) && !/^Pi-Desktop-Mate-/.test(a.name));
  const find = (re: RegExp) => desktop.find((a) => re.test(a.name));
  switch (platform) {
    case "win32":
      return find(/^Pi-Desktop-Setup-.*\.exe$/);
    case "darwin":
      return find(new RegExp(`-${arch === "arm64" ? "arm64" : "x64"}\\.dmg$`)) ?? find(/\.dmg$/);
    case "linux":
      return find(/\.AppImage$/) ?? find(/\.deb$/);
    default:
      return undefined;
  }
}

/** 설치된 Pi Desktop 실행 파일(macOS는 .app). 기본 설치 위치만 본다 */
export function findPiDesktop(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates: string[] = [];
  if (platform === "win32") {
    // electron-builder nsis 사용자 설치 기본 위치: %LOCALAPPDATA%\Programs\<설치본 이름>
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, "Programs", "pi-desktop", "Pi Desktop.exe"));
    if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, "Pi Desktop", "Pi Desktop.exe"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/Pi Desktop.app", join(homedir(), "Applications", "Pi Desktop.app"));
  } else {
    candidates.push("/opt/Pi Desktop/pi-desktop", "/usr/bin/pi-desktop");
  }
  return candidates.find((path) => existsSync(path));
}
