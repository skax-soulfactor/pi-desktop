// Mate 실행기 진입점. 사용법: node mate-runner.mjs <start|daemon|stop|run <임무 id>>
//
// - start: 실행기가 없거나 번들이 바뀌었으면(도는 실행이 없을 때) 새로 띄운다. 앱이 켜질 때 부른다.
// - daemon: 상주 실행기 본체 (start가 분리된 프로세스로 띄움)
// - status: Pi 준비 상태(설치·버전·로그인한 프로바이더·쓸 수 있는 모델·Pi 기본 모델)를 JSON으로
// - run: 임무 하나를 지금 이 프로세스에서 실행하고 기록을 출력한다 (확인·테스트용)
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { locatePi } from "../../host-agent/src/pi-locator";
import { spawnDaemon } from "../../host-agent/src/spawn-daemon";
import { acquirePid, fileHash, isAlive, log, readPid, releasePid, Runner, runDuty, type RunnerOptions } from "./daemon";
import type { PiLaunch } from "./executor";
import { mateHome, matePaths } from "./paths";
import { piReadiness } from "./pi-readiness";
import { getDuty, loadState } from "./store";

const script = fileURLToPath(import.meta.url);
const paths = matePaths(mateHome());

function kitDir(): string {
  return process.env.PI_DESKTOP_MATE_KIT || resolve(dirname(script), "../../mate-kit");
}

async function findPi(): Promise<PiLaunch> {
  const found = await locatePi();
  return { cliPath: found.cliPath, ...(found.nodePath ? { nodePath: found.nodePath } : {}), ...(found.env ? { env: found.env } : {}) };
}

async function options(): Promise<RunnerOptions> {
  return { paths, kitDir: kitDir(), locatePi: findPi, build: await fileHash(script) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return true;
  return false;
}

async function start(): Promise<void> {
  const pid = await readPid(paths);
  if (isAlive(pid)) {
    const state = await loadState(paths);
    const build = await fileHash(script);
    if (state.build === build || state.current) {
      console.log(JSON.stringify({ status: "running", pid, replaced: false }));
      return;
    }
    // 번들이 바뀌었고 도는 실행이 없으면 새 실행기로 바꾼다 (Host Agent의 데몬 교체와 같은 이유)
    await log(paths, `runner replace pid=${pid} build=${state.build}→${build}`);
    try {
      process.kill(pid!);
    } catch {
      // 이미 끝남
    }
    await waitFor(async () => !isAlive(pid), 5_000);
  }
  await spawnDaemon(script, process.env);
  const started = await waitFor(async () => isAlive(await readPid(paths)), 10_000);
  console.log(JSON.stringify({ status: started ? "started" : "failed", pid: await readPid(paths) }));
  if (!started) process.exitCode = 1;
}

async function daemon(): Promise<void> {
  if (!(await acquirePid(paths))) return;
  const runner = new Runner(await options());
  const shutdown = async () => {
    await runner.stop();
    await releasePid(paths);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("uncaughtException", (error) => void log(paths, `uncaught ${error.stack ?? error}`));
  await runner.start();
}

async function stop(): Promise<void> {
  const pid = await readPid(paths);
  if (isAlive(pid)) process.kill(pid!);
  console.log(JSON.stringify({ status: "stopped", pid }));
}

async function runOnce(id: string | undefined): Promise<void> {
  const duty = id ? await getDuty(paths, id) : undefined;
  if (!duty) throw new Error(`임무를 찾지 못했습니다: ${id ?? "(없음)"}`);
  console.log(JSON.stringify(await runDuty(await options(), duty, { reason: "manual" }), null, 2));
}

const [command, arg] = process.argv.slice(2);
async function status(): Promise<void> {
  console.log(JSON.stringify(await piReadiness()));
}

const commands: Record<string, () => Promise<void>> = { start, daemon, stop, status, run: () => runOnce(arg) };
const handler = command ? commands[command] : undefined;
if (!handler) {
  console.error("사용법: mate-runner <start|daemon|stop|status|run <임무 id>>");
  process.exitCode = 2;
} else {
  handler().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
