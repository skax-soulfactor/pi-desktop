/**
 * 호스트 간 리소스 복사 화면의 순수 함수들 (설계 §5.9).
 * 스킬은 모델이 그 안의 스크립트를 실행하게 할 수 있어, 대상 OS에서 돌지 않을 것 같은 스크립트를 미리 알린다.
 */

const POSIX_SCRIPTS = /\.(sh|bash|zsh)$/i;
const WINDOWS_SCRIPTS = /\.(ps1|bat|cmd)$/i;

/**
 * 복사할 파일과 대상 호스트의 OS(Node의 process.platform)로 경고를 만든다.
 * OS를 아직 모르면(연결 전) OS별 경고는 하지 않는다.
 */
export function copyWarnings(files: ReadonlyArray<{ path: string }>, targetPlatform: string | undefined): string[] {
  const warnings: string[] = [];
  const posix = files.filter((f) => POSIX_SCRIPTS.test(f.path)).map((f) => f.path);
  const windows = files.filter((f) => WINDOWS_SCRIPTS.test(f.path)).map((f) => f.path);
  if (targetPlatform === "win32" && posix.length > 0) {
    warnings.push(`대상은 Windows입니다. 셸 스크립트(${posix.join(", ")})는 bash가 없으면 돌지 않습니다.`);
  }
  if (targetPlatform && targetPlatform !== "win32" && windows.length > 0) {
    warnings.push(`대상은 ${targetPlatform}입니다. PowerShell·배치 스크립트(${windows.join(", ")})는 돌지 않을 수 있습니다.`);
  }
  return warnings;
}

/** 대상에 이미 있어 거부되었는지 (데몬의 "이미 있는 …입니다" 오류) */
export function isAlreadyExists(message: string): boolean {
  return message.includes("이미 있는");
}

/**
 * 로컬 경로 패키지 소스인지 (./x, ../x, /x, ~/x, C:\x, file:). 경로는 호스트마다 달라 다른 호스트에 그대로 설치할 수 없다.
 * npm:·git:·https: 소스는 어디서나 같은 것을 받는다.
 */
export function isLocalPathSource(source: string): boolean {
  return /^(\.{1,2}[\\/]|[\\/]|~[\\/]|[A-Za-z]:|file:)/.test(source.trim());
}

/** 다른 호스트에 같은 소스로 설치하는 pi 인자. project면 -l */
export function packageInstallArgs(source: string, scope: "user" | "project"): string[] {
  if (isLocalPathSource(source)) throw new Error(`로컬 경로 패키지는 다른 호스트에 그대로 설치할 수 없습니다: ${source}`);
  return ["install", source, ...(scope === "project" ? ["-l"] : [])];
}

/** 경로의 마지막 이름 (구분자 / \ 모두) */
export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 대상 호스트의 폴더에 파일 이름을 붙인다. Windows 호스트는 \, 그 밖은 / */
export function joinHostPath(dir: string, name: string, platform: string | undefined): string {
  const sep = platform === "win32" ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** 대상 호스트 기준으로 해석되는 로컬 주소인지 (localhost·127.x·0.0.0.0·[::1]) */
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "0.0.0.0" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** 복사할 때 뺀 비밀 필드를 사람이 읽을 문구로 */
export function droppedText(dropped: readonly string[]): string | undefined {
  if (dropped.length === 0) return undefined;
  const names = dropped.map((d) => (d === "apiKey" ? "API 키" : d.startsWith("headers.") ? `헤더 ${d.slice(8)}` : d));
  return `비밀일 수 있어 옮기지 않습니다: ${names.join(", ")}. 대상 호스트에서 다시 넣으세요 (Pi 관리 → 모델 또는 프로바이더).`;
}
