import { execFile } from "node:child_process";
import type { LaunchSpec } from "./host-connection";
import { deployAgent, runCommand, shQuote } from "./remote-agent";

/**
 * WSL 호스트 지원 (설계 §3.2 WSL transport, §5.5).
 *
 * WSL 안에서는 Windows 파일이 보이지 않을 수 있다(`/etc/wsl.conf`의 automount 해제).
 * 그래서 Agent 번들을 WSL 홈(`~/.pi-desktop/agent/`)으로 복사해 두고 그 파일을 실행한다.
 * 파일 이름에 내용 해시를 넣어, 앱이 업데이트되면 새 파일을 올리고 같은 버전이면 다시 올리지 않는다.
 */

const WSL_EXE = "wsl.exe";

/**
 * `wsl.exe -l -q` 출력에서 배포판 이름을 뽑는다.
 * wsl.exe는 UTF-16LE로 출력하고, 앞에 BOM이나 줄 끝에 CR이 붙을 수 있다.
 */
export function parseDistroList(output: Buffer): string[] {
  const text = looksUtf16(output) ? output.toString("utf16le") : output.toString("utf8");
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter((line) => line.length > 0);
}

/** 짝수 바이트 위치마다 0이 많으면 UTF-16LE로 본다 (ASCII 배포판 이름 기준). */
function looksUtf16(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return true;
  let zeros = 0;
  for (let i = 1; i < Math.min(buffer.length, 64); i += 2) if (buffer[i] === 0) zeros++;
  return zeros > 0 && zeros >= Math.min(buffer.length, 64) / 4;
}

/** 설치된 WSL 배포판 목록. WSL이 없거나 Windows가 아니면 빈 배열. */
export function listWslDistros(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(WSL_EXE, ["-l", "-q"], { encoding: "buffer", timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? [] : parseDistroList(stdout));
    });
  });
}

/** wsl.exe로 셸 스크립트를 실행한다. stdin으로 바이트를 그대로 넘길 수 있다. */
function runInWsl(distro: string, script: string, input?: Buffer): Promise<string> {
  return runCommand(WSL_EXE, ["-d", distro, "--cd", "~", "--exec", "sh", "-c", script], `WSL(${distro})`, input);
}

export interface WslPrepareOptions {
  distro: string;
  /** 로컬의 번들된 Agent 파일 (dist/host-agent.mjs) */
  agentScript: string;
  agentVersion: string;
}

/** WSL 연결을 준비한다: node 확인 → 필요하면 Agent 업로드 → 연결기 실행 명령 반환. */
export async function prepareWsl(options: WslPrepareOptions): Promise<LaunchSpec> {
  const deployed = await deployAgent({
    label: `WSL(${options.distro})`,
    run: (script, input) => runInWsl(options.distro, script, input),
    agentScript: options.agentScript,
    agentVersion: options.agentVersion,
    nodeHint: "Pi 관리 창의 설치 안내를 따르거나 배포판에 Node.js 22 이상을 설치하세요.",
  });
  return {
    command: WSL_EXE,
    args: ["-d", options.distro, "--cd", "~", "--exec", "sh", "-c", `exec ${shQuote(deployed.node)} ${shQuote(deployed.remotePath)} connect`],
    agentBuild: deployed.agentBuild,
  };
}
