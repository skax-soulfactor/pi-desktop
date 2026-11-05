import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Pi Desktop 찾기. 0.7.0부터 Mate는 Pi Desktop 안의 작업 공간이라, 이것은 옛 단독 Mate 앱의 징검다리(index.ts)만 쓴다
 * ("Pi Desktop으로 합쳐졌습니다" → Pi Desktop 열기, 로그인할 때 Pi Desktop에 실행기 확인 맡기기).
 * Mate 작업 공간의 Pi 관리는 Pi 작업 공간이 연다 (mate-main.ts openPiManager).
 */
export const PI_DESKTOP_REPO = "soulfactorx/pi-desktop";

/**
 * 설치된 Pi Desktop 실행 파일(macOS는 .app).
 * - Windows: 기본 설치 위치(%LOCALAPPDATA%\Programs\Pi Desktop — electron-builder nsis는 폴더 이름으로 제품 이름을 쓴다)를 보고,
 *   없으면 설치 정보(레지스트리 프로그램 제거 항목)의 아이콘 경로를 읽는다. 사용자가 설치 폴더를 바꾼 경우도 찾기 위해서다
 * - macOS·Linux: 기본 설치 위치
 */
export async function findPiDesktop(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  readUninstall: () => Promise<string> = readUninstallEntries,
): Promise<string | undefined> {
  const candidates: string[] = [];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, "Programs", "Pi Desktop", "Pi Desktop.exe"));
    if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, "Pi Desktop", "Pi Desktop.exe"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/Pi Desktop.app", join(homedir(), "Applications", "Pi Desktop.app"));
  } else {
    candidates.push("/opt/Pi Desktop/pi-desktop", "/usr/bin/pi-desktop");
  }
  const found = candidates.find((path) => existsSync(path));
  if (found || platform !== "win32") return found;
  const fromRegistry = piDesktopFromUninstall(await readUninstall().catch(() => ""));
  return fromRegistry && existsSync(fromRegistry) ? fromRegistry : undefined;
}

/**
 * `reg query … /s` 출력에서 Pi Desktop(Mate·Agent 제외)의 실행 파일 경로를 찾는다.
 * 항목마다 DisplayName("Pi Desktop 0.1.15")과 DisplayIcon("…\Pi Desktop.exe,0")이 있다.
 */
export function piDesktopFromUninstall(output: string): string | undefined {
  for (const block of output.split(/\r?\n(?=HKEY_)/)) {
    const name = /^\s*DisplayName\s+REG_SZ\s+(.+)$/m.exec(block)?.[1]?.trim();
    if (!name || !/^Pi Desktop \d/.test(name)) continue;
    const icon = /^\s*DisplayIcon\s+REG_SZ\s+(.+)$/m.exec(block)?.[1]?.trim();
    if (icon) return icon.replace(/,\d+$/, "").replace(/^"|"$/g, "");
  }
  return undefined;
}

function readUninstallEntries(): Promise<string> {
  const keys = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];
  return Promise.all(
    keys.map(
      (key) =>
        new Promise<string>((resolve) =>
          execFile("reg", ["query", key, "/s"], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }, (_e, stdout) =>
            resolve(String(stdout ?? "")),
          ),
        ),
    ),
  ).then((outs) => outs.join("\n"));
}
