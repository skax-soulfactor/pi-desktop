import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NodeRuntime {
  command: string;
  env: Record<string, string>;
}

/**
 * 실행기(와 그 아래 Pi)를 실행할 Node를 고른다. Pi Desktop의 node-runtime과 같은 규칙이다.
 * 시스템 node를 우선하고, 없으면 Electron 실행 파일을 Node 모드로 쓴다.
 * (앱끼리 소스를 import하지 않도록 따로 둔다. 설계 DESIGN-MATE.md §7)
 */
export async function resolveNodeRuntime(): Promise<NodeRuntime> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, ["node"], { timeout: 5_000, windowsHide: true });
    const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
    if (first) return { command: first, env: {} };
  } catch {
    // 아래 대체 경로로 진행
  }
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/**
 * 실행기 명령(start·stop)을 부른다. start는 실행기가 없거나 번들이 바뀌었으면 분리된 프로세스로 새로 띄우고 끝난다.
 * 실행기는 앱을 닫아도 남아 시간표를 지킨다.
 */
export async function runnerCommand(
  script: string,
  command: "start" | "stop",
  env: Record<string, string>,
): Promise<{ status: string; pid?: number }> {
  const runtime = await resolveNodeRuntime();
  const { stdout } = await execFileAsync(runtime.command, [script, command], {
    env: { ...process.env, ...runtime.env, ...env },
    timeout: 30_000,
    windowsHide: true,
  });
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as { status: string; pid?: number };
}
