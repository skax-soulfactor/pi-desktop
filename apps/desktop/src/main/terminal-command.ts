import type { PiLocation } from "@pi-desktop/host-protocol";
import type { SshHostConfig } from "../shared/api";
import { shQuote } from "./remote-agent";
import { remoteSh, sshArgs } from "./ssh";

/**
 * 내장 터미널에서 실행할 명령을 정한다 (설계 §4.12). 순수 함수라 테스트한다.
 *
 * - 로컬(Windows): Pi는 찾은 Pi의 node와 cli.js로 직접 실행하고(pi.cmd shim을 거치지 않는다), 셸은 PowerShell.
 * - WSL: wsl.exe가 배포판 안에서 실행한다. Windows ConPTY가 WSL까지 감싸므로 창 크기 조정도 된다.
 *   Pi는 데몬이 찾은 node·cli.js와 그 환경 변수(관리형 설치의 PI_MANAGED_INSTALL_ROOT 등)로 실행한다.
 * - SSH: `ssh -t`로 서버에 터미널을 붙인다. 셸은 서버 사용자의 로그인 셸, Pi는 WSL과 같은 방식으로 실행한다.
 */

export type TerminalKind = "pi" | "shell";

export interface TerminalTarget {
  /** "local", "wsl:<배포판>" 또는 "ssh:<이름>" */
  hostId: string;
  kind: TerminalKind;
  /** 작업 폴더 (호스트 기준 경로). 없으면 홈 */
  cwd?: string;
  /** pi에 붙일 인자 (예: --session <파일>) */
  args?: string[];
  /** SSH 호스트면 그 설정과 실행할 ssh */
  ssh?: { executable: string; host: SshHostConfig };
}

/** pi를 실행할 때 쓰는 데몬의 정보: 찾은 Pi와, Pi를 실행할 node 경로 */
export interface PiRuntime {
  pi: PiLocation;
  nodePath: string;
}

export interface TerminalCommand {
  file: string;
  args: string[];
  /** 로컬 실행에서 추가할 환경 변수 (WSL은 명령 안에서 env로 넘긴다) */
  env: Record<string, string>;
  /** 로컬 실행의 작업 폴더 */
  cwd?: string;
  /** 탭 제목 */
  title: string;
}

const WSL_PREFIX = "wsl:";

export function terminalCommand(target: TerminalTarget, runtime: PiRuntime | undefined): TerminalCommand {
  const pi = target.kind === "pi";
  if (pi && !runtime) throw new Error("이 호스트에서 Pi를 찾지 못했습니다");
  const piArgs = pi ? [runtime!.pi.cliPath, ...(target.args ?? [])] : [];
  const title = pi ? "pi" : "셸";

  if (target.hostId.startsWith(WSL_PREFIX)) {
    const distro = target.hostId.slice(WSL_PREFIX.length);
    if (!distro) throw new Error("WSL 배포판 이름이 없습니다");
    const base = ["-d", distro, "--cd", target.cwd || "~"];
    if (!pi) return { file: "wsl.exe", args: base, env: {}, title: `${title} (WSL: ${distro})` };
    const envArgs = Object.entries(runtime!.pi.env ?? {}).map(([k, v]) => `${k}=${v}`);
    return {
      file: "wsl.exe",
      args: [...base, "--exec", "env", ...envArgs, runtime!.nodePath, ...piArgs],
      env: {},
      title: `${title} (WSL: ${distro})`,
    };
  }

  if (target.hostId.startsWith("ssh:")) {
    if (!target.ssh) throw new Error(`등록되지 않은 SSH 호스트입니다: ${target.hostId}`);
    const { executable, host } = target.ssh;
    // 작업 폴더가 없으면 홈에서 연다. 따옴표로 감싼 ~는 펼쳐지지 않으므로 그대로 둔다.
    const cd = `cd ${target.cwd ? shQuote(target.cwd) : "~"}`;
    const run = pi
      ? `${cd} && exec env ${Object.entries(runtime!.pi.env ?? {})
          .map(([k, v]) => shQuote(`${k}=${v}`))
          .concat([runtime!.nodePath, ...piArgs].map(shQuote))
          .join(" ")}`
      : `${cd} && exec "\${SHELL:-sh}" -l`;
    return { file: executable, args: [...sshArgs(host, true), remoteSh(run)], env: {}, title: `${title} (SSH: ${host.name})` };
  }

  if (target.hostId !== "local") throw new Error(`이 호스트의 터미널은 아직 지원하지 않습니다: ${target.hostId}`);
  const command: TerminalCommand = pi
    ? { file: runtime!.nodePath, args: piArgs, env: { ...(runtime!.pi.env ?? {}) }, title }
    : { file: "powershell.exe", args: ["-NoLogo"], env: {}, title };
  if (target.cwd) command.cwd = target.cwd;
  return command;
}
