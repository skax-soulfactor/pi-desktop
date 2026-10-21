import { posix, win32 } from "node:path";

/** WSL 배포판 파일을 Windows에서 여는 공유 경로 접두사 (`\\wsl.localhost\`) */
const WSL_SHARE = "\\\\wsl.localhost\\";

/**
 * 툴이 다룬 파일 경로를 이 PC(Windows 탐색기)에서 열 수 있는 경로로 바꾼다.
 * - 로컬: 세션 작업 폴더 기준으로 푼 Windows 경로
 * - WSL: 배포판 안의 경로를 `\\wsl.localhost\<배포판>\...` 공유 경로로
 * 그 밖의 호스트(SSH 등)는 이 PC에서 열 수 없으므로 undefined.
 */
export function hostPathForExplorer(hostId: string, cwd: string, path: string, wslPrefix: string): string | undefined {
  if (hostId === "local") return win32.resolve(cwd, path);
  if (hostId.startsWith(wslPrefix)) {
    const distro = hostId.slice(wslPrefix.length);
    if (!distro) return undefined;
    const absolute = posix.resolve(cwd, path);
    return `${WSL_SHARE}${distro}${absolute.replace(/\//g, "\\")}`;
  }
  return undefined;
}
