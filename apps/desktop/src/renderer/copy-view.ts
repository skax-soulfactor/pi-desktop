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
