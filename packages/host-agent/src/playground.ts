import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PiLocation, PlaygroundRunResult } from "@pi-desktop/host-protocol";

/**
 * SDK Playground (설계 §4.10): 앱에서 쓴 스크립트를 이 호스트에서 이 호스트의 Pi SDK로 실행한다.
 * WSL·SSH 호스트면 그 안의 Pi SDK로 개발하고 시험할 수 있다.
 *
 * - 스크립트는 ES 모듈(JavaScript)이다. 맨 앞에 설치된 Pi의 SDK를 \`pi\`로 불러오는 줄을 붙이므로
 *   \`await pi.SessionManager.listAll()\`처럼 바로 쓴다. 최상위 await를 쓸 수 있다.
 * - Pi를 실행하는 것과 같은 node·환경으로 띄운다. 앱 홈의 playground 폴더에 임시 파일로 쓰고, 끝나면 지운다.
 * - 출력은 바로바로 알리고(onOutput), 너무 많으면 자른다. 제한 시간을 넘거나 stop하면 멈춘다.
 * 사용자가 쓴 코드를 그대로 실행하는 기능이므로 터미널처럼 그 사용자의 권한으로 돈다.
 */

/** 기본 제한 시간 */
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
/** 출력 한도 (넘으면 그 뒤는 버리고 알린다) */
export const OUTPUT_LIMIT = 1024 * 1024;

/** 사용자 스크립트 앞에 붙이는 줄: 설치된 Pi의 SDK를 pi로 불러온다 */
export function playgroundSource(pi: PiLocation, code: string): string {
  const sdk = pathToFileURL(join(pi.packageDir, "dist", "index.js")).href;
  return `const pi = await import(${JSON.stringify(sdk)});\n${code}\n`;
}

export class Playground {
  private readonly runs = new Map<string, ChildProcess>();

  constructor(private readonly dir: string) {}

  async run(
    pi: PiLocation,
    params: { runId: string; code: string; cwd?: string; timeoutMs?: number },
    options: { env?: NodeJS.ProcessEnv; onOutput: (stream: "stdout" | "stderr", text: string) => void },
  ): Promise<PlaygroundRunResult> {
    if (this.runs.has(params.runId)) throw new Error(`이미 실행 중입니다: ${params.runId}`);
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `run-${process.pid}-${Date.now()}.mjs`);
    await writeFile(file, playgroundSource(pi, params.code), "utf8");
    const started = Date.now();
    try {
      return await new Promise<PlaygroundRunResult>((resolve) => {
        const child = spawn(pi.nodePath ?? process.execPath, [file], {
          cwd: params.cwd || homedir(),
          env: { ...(options.env ?? process.env), ...pi.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        this.runs.set(params.runId, child);
        let size = 0;
        let truncated = false;
        let timedOut = false;
        const onData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
          if (truncated) return;
          const text = chunk.toString("utf8");
          size += text.length;
          if (size > OUTPUT_LIMIT) {
            truncated = true;
            options.onOutput("stderr", "\n[출력이 너무 많아 여기까지만 보입니다]\n");
            return;
          }
          options.onOutput(stream, text);
        };
        child.stdout?.on("data", onData("stdout"));
        child.stderr?.on("data", onData("stderr"));
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const finish = (exitCode: number | null, signal: string | null) => {
          clearTimeout(timer);
          this.runs.delete(params.runId);
          const result: PlaygroundRunResult = { exitCode, durationMs: Date.now() - started, timedOut, truncated };
          if (signal) result.signal = signal;
          resolve(result);
        };
        child.on("error", (error) => {
          options.onOutput("stderr", `[실행 오류] ${error.message}\n`);
          finish(null, null);
        });
        child.on("close", (code, signal) => finish(code, signal));
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  /** 실행 중이면 멈춘다. 멈췄으면 true */
  stop(runId: string): boolean {
    const child = this.runs.get(runId);
    if (!child) return false;
    child.kill();
    return true;
  }
}
