import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { socketPath } from "./paths";

export interface ConnectOptions {
  env?: NodeJS.ProcessEnv;
  /** 데몬이 없으면 띄울 때 실행할 Host Agent 스크립트 경로 (기본: 현재 실행 중인 스크립트) */
  agentScript?: string;
  /** 데몬이 뜰 때까지 기다리는 최대 시간 (ms) */
  startTimeoutMs?: number;
}

/**
 * 데몬 소켓에 연결한다. 데몬이 없으면 분리(detached) 프로세스로 띄운 뒤 연결한다.
 *
 * 데몬을 분리 실행하는 이유: 연결기는 SSH 세션이나 앱과 함께 죽지만,
 * 데몬과 그 아래의 Pi 프로세스는 계속 살아 있어야 하기 때문이다 (설계 §3.4).
 */
export async function connectToDaemon(options: ConnectOptions = {}): Promise<Socket> {
  const env = options.env ?? process.env;
  const path = socketPath(env);

  const existing = await tryConnect(path);
  if (existing) return existing;

  const script = options.agentScript ?? process.argv[1];
  if (!script) throw new Error("Host Agent 스크립트 경로를 알 수 없습니다");
  const child = spawn(process.execPath, [script, "daemon"], {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + (options.startTimeoutMs ?? 10_000);
  let delay = 50;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const socket = await tryConnect(path);
    if (socket) return socket;
    delay = Math.min(delay * 2, 500);
  }
  throw new Error(`데몬에 연결하지 못했습니다: ${path}`);
}

/**
 * 연결기 본체: 표준 입출력과 데몬 소켓을 그대로 이어준다.
 * 내용은 해석하지 않는다. 어느 한쪽이 닫히면 함께 끝난다.
 */
export async function runConnect(options: ConnectOptions = {}): Promise<void> {
  const socket = await connectToDaemon(options);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    socket.once("close", done);
    process.stdin.once("end", () => socket.end());
    process.stdin.once("close", () => socket.end());
  });
}

function tryConnect(path: string): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}
