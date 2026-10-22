/**
 * 자동 업데이트 방식 (M5 인스톨러·자동 업데이트). electron 없이 판단하는 순수 함수라 테스트한다.
 *
 * - Windows(NSIS 설치본): 서명이 없어도 electron-updater가 내려받아 다시 시작할 때 설치한다.
 * - Linux AppImage(APPIMAGE 환경 변수가 있음): 내려받아 바꿔 끼운다.
 * - macOS: 서명(Apple Developer ID)이 없으면 Squirrel.Mac이 설치를 거부하므로, 새 버전을 알리고 릴리스 페이지를 연다.
 * - Linux deb 등 그 밖: 패키지 관리자가 설치하므로 알리기만 한다.
 */

export type UpdateMode = "auto" | "notify";

export function updateMode(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): UpdateMode {
  if (platform === "win32") return "auto";
  if (platform === "linux" && env.APPIMAGE) return "auto";
  return "notify";
}

/** 그 버전의 GitHub 릴리스 페이지 */
export function releaseUrl(owner: string, repo: string, version: string): string {
  return `https://github.com/${owner}/${repo}/releases/tag/v${version.replace(/^v/, "")}`;
}

/** 시작한 뒤 처음 확인까지와 그 뒤 확인 간격 */
export const FIRST_CHECK_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
