import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { LaunchSpec } from "./host-connection";

/**
 * WSL 호스트 지원 (설계 §3.2 WSL transport, §5.5).
 *
 * WSL 안에서는 Windows 파일이 보이지 않을 수 있다(`/etc/wsl.conf`의 automount 해제).
 * 그래서 Agent 번들을 WSL 홈(`~/.pi-desktop/agent/`)으로 복사해 두고 그 파일을 실행한다.
 * 파일 이름에 내용 해시를 넣어, 앱이 업데이트되면 새 파일을 올리고 같은 버전이면 다시 올리지 않는다.
 */

/** Pi가 요구하는 최소 Node 주 버전 */
const MIN_NODE_MAJOR = 22;
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

/** POSIX 셸용 작은따옴표 인용. 어떤 문자열이든 단일 인자로 전달된다. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ProbeResult {
  home: string;
  /** 사용할 node 경로. 없으면 빈 문자열 */
  node: string;
  nodeVersion: string;
  /** 같은 해시의 Agent가 이미 올라가 있는지 */
  agentPresent: boolean;
}

/** 원격 탐지 스크립트의 `key=value` 출력을 읽는다. 알 수 없는 줄(로그인 안내 등)은 무시한다. */
export function parseProbe(output: string): ProbeResult {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^pi-desktop-(\w+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1]!, match[2]!);
  }
  return {
    home: values.get("home") ?? "",
    node: values.get("node") ?? "",
    nodeVersion: values.get("nodeVersion") ?? "",
    agentPresent: values.get("agent") === "1",
  };
}

/** "v24.20.0" → 24. 읽을 수 없으면 0 */
export function nodeMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : 0;
}

/** 번들 내용으로 원격 파일 이름을 정한다. */
export function agentFileName(version: string, bundle: Buffer): string {
  const hash = createHash("sha256").update(bundle).digest("hex").slice(0, 12);
  return `host-agent-${version}-${hash}.mjs`;
}

/**
 * 원격에서 node와 Agent 파일을 확인하는 스크립트.
 * PATH에 node가 없으면 Pi 공식 설치기가 깐 Node(pi-node)를 쓴다.
 */
export function probeScript(agentFile: string): string {
  return [
    'NODE="$(command -v node 2>/dev/null || true)"',
    'if [ -z "$NODE" ] && [ -x "$HOME/.local/share/pi-node/current/bin/node" ]; then NODE="$HOME/.local/share/pi-node/current/bin/node"; fi',
    'printf "pi-desktop-home=%s\\n" "$HOME"',
    'printf "pi-desktop-node=%s\\n" "$NODE"',
    'if [ -n "$NODE" ]; then printf "pi-desktop-nodeVersion=%s\\n" "$("$NODE" -v)"; fi',
    `if [ -f "$HOME/.pi-desktop/agent/${agentFile}" ]; then echo pi-desktop-agent=1; else echo pi-desktop-agent=0; fi`,
  ].join("\n");
}

/** wsl.exe로 셸 스크립트를 실행한다. stdin으로 바이트를 그대로 넘길 수 있다. */
function runInWsl(distro: string, script: string, input?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(WSL_EXE, ["-d", distro, "--cd", "~", "--exec", "sh", "-c", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else {
        const detail = stderr
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.includes("Failed to translate"))
          .slice(-5)
          .join("\n");
        reject(new Error(`WSL(${distro}) 명령 실패 (code ${code})${detail ? `: ${detail}` : ""}`));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export interface WslPrepareOptions {
  distro: string;
  /** 로컬의 번들된 Agent 파일 (dist/host-agent.mjs) */
  agentScript: string;
  agentVersion: string;
}

/**
 * WSL 연결을 준비한다: node 확인 → 필요하면 Agent 업로드 → 연결기 실행 명령 반환.
 * 업로드는 임시 파일에 쓴 뒤 mv로 바꿔치기해, 실행 중인 데몬이 읽는 파일을 망가뜨리지 않는다.
 */
export async function prepareWsl(options: WslPrepareOptions): Promise<LaunchSpec> {
  const bundle = await readFile(options.agentScript);
  const fileName = agentFileName(options.agentVersion, bundle);
  const probe = parseProbe(await runInWsl(options.distro, probeScript(fileName)));

  if (!probe.node) {
    throw new Error(
      `WSL(${options.distro})에서 Node.js를 찾지 못했습니다. Pi를 설치하면 함께 설치됩니다 (Pi 설치 마법사는 M2).`,
    );
  }
  if (nodeMajor(probe.nodeVersion) < MIN_NODE_MAJOR) {
    throw new Error(`WSL(${options.distro})의 Node.js ${probe.nodeVersion}는 너무 오래되었습니다. ${MIN_NODE_MAJOR} 이상이 필요합니다.`);
  }

  const remotePath = `${probe.home}/.pi-desktop/agent/${fileName}`;
  if (!probe.agentPresent) {
    const tmp = `${remotePath}.uploading`;
    await runInWsl(
      options.distro,
      `mkdir -p ${shQuote(`${probe.home}/.pi-desktop/agent`)} && cat > ${shQuote(tmp)} && mv ${shQuote(tmp)} ${shQuote(remotePath)}`,
      bundle,
    );
  }

  return {
    command: WSL_EXE,
    args: ["-d", options.distro, "--cd", "~", "--exec", "sh", "-c", `exec ${shQuote(probe.node)} ${shQuote(remotePath)} connect`],
  };
}
