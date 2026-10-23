import { createConnection, type Socket } from "node:net";
import { Notifications } from "@pi-desktop/host-protocol";
import { clientHandshake, readToken } from "./handshake";
import { spawnDaemon } from "./spawn-daemon";
import { socketPath } from "./paths";

export interface ConnectOptions {
  env?: NodeJS.ProcessEnv;
  /** 데몬이 없으면 띄울 때 실행할 Host Agent 스크립트 경로 (기본: 현재 실행 중인 스크립트) */
  agentScript?: string;
  /** 데몬이 뜰 때까지 기다리는 최대 시간 (ms) */
  startTimeoutMs?: number;
}

/**
 * 데몬 소켓에 연결한다. 데몬이 없으면 연결기와 분리된 프로세스로 띄운 뒤 연결한다 (spawn-daemon.ts).
 *
 * 데몬을 분리 실행하는 이유: 연결기는 SSH 세션이나 앱과 함께 죽지만,
 * 데몬과 그 아래의 Pi 프로세스는 계속 살아 있어야 하기 때문이다 (설계 §3.4).
 */
export async function connectToDaemon(options: ConnectOptions = {}): Promise<Socket> {
  const env = options.env ?? process.env;
  const path = socketPath(env);

  const existing = await tryConnect(path);
  if (existing) return existing;
  return startAndConnect(path, env, options);
}

/** 연결 결과: 소켓, 데몬 신원 확인 여부, 인증 뒤에 이미 받은 데몬 출력 */
export interface DaemonConnection {
  socket: Socket;
  status: "verified" | "legacy";
  rest: Buffer;
}

/** 데몬에 붙고 토큰으로 서로를 확인한다 (handshake.ts). 데몬이 증명하지 못하면 오류를 던진다. */
export async function connectVerified(options: ConnectOptions = {}): Promise<DaemonConnection> {
  const env = options.env ?? process.env;
  const socket = await connectToDaemon(options);
  try {
    return { socket, ...(await clientHandshake(socket, () => readToken(env))) };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function startAndConnect(path: string, env: NodeJS.ProcessEnv, options: ConnectOptions): Promise<Socket> {
  const script = options.agentScript ?? process.argv[1];
  if (!script) throw new Error("Host Agent 스크립트 경로를 알 수 없습니다");
  await spawnDaemon(script, env);

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
 * 연결기 본체: 데몬과 서로 확인한 뒤 표준 입출력과 데몬 소켓을 그대로 이어준다.
 * 내용은 해석하지 않는다. 어느 한쪽이 닫히면 함께 끝난다.
 * 확인 전에는 앱이 보낸 요청(stdin)을 넘기지 않는다. 가짜 데몬에 API 키 같은 요청이 가지 않게 하기 위해서다.
 */
export async function runConnect(options: ConnectOptions = {}): Promise<void> {
  const { socket, status, rest } = await connectVerified(options);
  // Windows 파이프는 다른 사용자도 같은 이름을 만들 수 있어, 인증 없는 데몬은 믿지 않는다고 앱에 알린다.
  // POSIX 소켓은 0700 폴더 안이라 예전 데몬도 같은 사용자의 것이다.
  if (status === "legacy" && process.platform === "win32") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: Notifications.connectorUnverified })}\n`);
  }
  if (rest.length > 0) process.stdout.write(rest);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.resume();
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
