import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { PiLocation, PiUpdateTarget } from "@pi-desktop/host-protocol";

/**
 * Pi Manager의 업데이트 실행 (설계 §4.9 "업데이트"). Pi의 `pi update`를 그대로 쓴다.
 *
 * - 설치 방식 판단은 Pi에 맡긴다. Pi는 관리형 설치·npm 전역 설치가 아니면 스스로 업데이트를 거부한다
 *   (예: Nix, 소스 체크아웃, 개발용 경로). 이때도 종료 코드가 0이므로 성공 여부는 앱이 버전을 다시 읽어 판단한다.
 * - 대상은 정해진 몇 가지만 받는다. 임의 인자를 넘겨 다른 명령을 실행할 수 없게 하기 위해서다.
 */

/** 대상별 `pi update` 인자 */
export const UPDATE_ARGS: Record<PiUpdateTarget, string[]> = {
  self: ["update", "--self"],
  extensions: ["update", "--extensions"],
  all: ["update", "--all"],
  models: ["update", "--models"],
};

/** 출력은 끝부분만 남긴다 (응답 크기 제한) */
const OUTPUT_LIMIT = 64 * 1024;
/** 너무 오래 걸리면 멈춘다 (네트워크가 멈춘 경우 등) */
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;

export interface PiUpdateRun {
  exitCode: number | null;
  /** 출력(표준 출력+오류) 끝부분 */
  output: string;
  timedOut: boolean;
}

export function isUpdateTarget(value: unknown): value is PiUpdateTarget {
  return typeof value === "string" && Object.hasOwn(UPDATE_ARGS, value);
}

export function runPiUpdate(
  pi: PiLocation,
  target: PiUpdateTarget,
  options: { force?: boolean; env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void; timeoutMs?: number } = {},
): Promise<PiUpdateRun> {
  const args = [pi.cliPath, ...UPDATE_ARGS[target], ...(options.force && target !== "models" ? ["--force"] : [])];
  return new Promise((resolve) => {
    const child = spawn(pi.nodePath ?? process.execPath, args, {
      cwd: homedir(),
      // 관리형 설치는 PI_MANAGED_INSTALL_ROOT가 있어야 자기 설치를 갱신한다 (pi-locator 참고).
      env: { ...(options.env ?? process.env), ...pi.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let timedOut = false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-OUTPUT_LIMIT);
      options.onOutput?.(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? UPDATE_TIMEOUT_MS);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode, output, timedOut });
    };
    child.on("error", (error) => {
      onData(Buffer.from(`\n[실행 오류] ${error.message}\n`));
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
