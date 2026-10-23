import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { PiLocation, PiModelRef, PiModelsResult } from "@pi-desktop/host-protocol";

/**
 * 이 호스트의 Pi가 쓸 수 있는 모델 목록 (설정 폼의 defaultProvider·defaultModel 선택지).
 *
 * Pi의 `pi --list-models`를 그대로 쓴다. 인증이 있는 프로바이더의 모델만 나오고, models.json의
 * 사용자 정의 프로바이더도 들어간다. SDK의 ModelRegistry는 내부 런타임을 만들어야 해서 표면이 넓으므로 CLI 출력을 읽는다.
 */

/** 너무 오래 걸리면 멈춘다 (확장 로딩이 멈춘 경우 등) */
const LIST_TIMEOUT_MS = 60_000;

/**
 * `pi --list-models` 표를 읽는다. 첫 줄은 머리글(provider model context …)이고, 각 줄의 앞 두 칸이 프로바이더와 모델 ID다.
 * 모델이 없으면 Pi는 표 대신 안내 문장을 내므로 빈 목록이 된다.
 */
export function parseListModels(output: string): PiModelRef[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const header = lines.findIndex((line) => /^provider\s+model\b/.test(line));
  if (header < 0) return [];
  const models: PiModelRef[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(header + 1)) {
    const [provider, id] = line.split(/\s+/);
    if (!provider || !id) continue;
    const key = `${provider}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ provider, id });
  }
  return models;
}

/** Pi를 `--list-models`로 실행해 쓸 수 있는 모델을 읽는다. 실패하면 오류를 담아 돌려준다 */
export function listPiModels(pi: PiLocation, env: NodeJS.ProcessEnv = process.env): Promise<PiModelsResult> {
  return new Promise((resolve) => {
    const child = spawn(pi.nodePath ?? process.execPath, [pi.cliPath, "--list-models"], {
      cwd: homedir(),
      env: { ...env, ...pi.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-4096)));
    const timer = setTimeout(() => child.kill(), LIST_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ models: [], error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const models = parseListModels(stdout);
      if (code === 0 || models.length > 0) resolve({ models });
      else resolve({ models, error: stderr.trim().split("\n").at(-1) || `pi --list-models 종료 코드 ${code}` });
    });
  });
}
