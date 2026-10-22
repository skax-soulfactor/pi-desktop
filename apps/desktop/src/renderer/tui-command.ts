/**
 * 세션을 터미널의 pi(TUI)로 이어 열기 위한 명령을 만든다 (설계 §5.4 "이 세션을 TUI에서 열기").
 *
 * - Windows(로컬): PowerShell과 Git Bash 모두에서 동작하도록 `;`로 잇고 큰따옴표로 감싼다.
 *   (cmd.exe의 `cd /d`나 `&`는 PowerShell에서 안 되므로 쓰지 않는다)
 * - WSL·Linux·macOS: POSIX 셸 기준으로 작은따옴표 인용과 `&&`를 쓴다.
 * 프로젝트의 AGENTS.md 등을 읽으려면 그 작업 폴더에서 실행해야 하므로 먼저 이동한다.
 * 세션 파일이 아직 없으면(메시지를 주고받기 전에는 Pi가 파일을 쓰지 않는다) 같은 세션 ID로 연다:
 * `--session-id`는 그 ID의 세션이 없으면 새로 만든다.
 */
export function tuiCommand(kind: "windows" | "posix", cwd: string, target: { sessionFile: string } | { sessionId: string }): string {
  const q = kind === "windows" ? dq : sq;
  const open = "sessionFile" in target ? `pi --session ${q(target.sessionFile)}` : `pi --session-id ${q(target.sessionId)}`;
  return kind === "windows" ? `cd ${q(cwd)}; ${open}` : `cd ${q(cwd)} && ${open}`;
}

/** 세션 파일 이름에서 Pi 세션 ID: <시각>_<ID>.jsonl */
export function piSessionIdOf(sessionFile: string): string | undefined {
  const name = sessionFile.split(/[\\/]/).pop() ?? "";
  const match = /^[^_]+_(.+)\.jsonl$/.exec(name);
  return match?.[1];
}

/** PowerShell·bash 공통으로 쓸 큰따옴표 인용. 경로에 큰따옴표는 올 수 없으므로 감싸기만 한다. */
function dq(value: string): string {
  return `"${value}"`;
}

/** POSIX 셸 작은따옴표 인용 */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
