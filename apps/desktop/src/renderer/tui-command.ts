/**
 * 세션을 터미널의 pi(TUI)로 이어 열기 위한 명령을 만든다 (설계 §5.4 "이 세션을 TUI에서 열기").
 *
 * - Windows(로컬): PowerShell과 Git Bash 모두에서 동작하도록 `;`로 잇고 큰따옴표로 감싼다.
 *   (cmd.exe의 `cd /d`나 `&`는 PowerShell에서 안 되므로 쓰지 않는다)
 * - WSL·Linux·macOS: POSIX 셸 기준으로 작은따옴표 인용과 `&&`를 쓴다.
 * 프로젝트의 AGENTS.md 등을 읽으려면 그 작업 폴더에서 실행해야 하므로 먼저 이동한다.
 */
export function tuiCommand(kind: "windows" | "posix", cwd: string, sessionFile: string): string {
  if (kind === "windows") return `cd ${dq(cwd)}; pi --session ${dq(sessionFile)}`;
  return `cd ${sq(cwd)} && pi --session ${sq(sessionFile)}`;
}

/** PowerShell·bash 공통으로 쓸 큰따옴표 인용. 경로에 큰따옴표는 올 수 없으므로 감싸기만 한다. */
function dq(value: string): string {
  return `"${value}"`;
}

/** POSIX 셸 작은따옴표 인용 */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
