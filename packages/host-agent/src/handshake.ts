import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Socket } from "node:net";
import { runDir } from "./paths";

/**
 * 데몬 소켓의 상호 인증 (보안 검토, 설계 §3.4).
 *
 * POSIX 소켓은 0700 폴더 안에 있어 같은 사용자만 닿는다. Windows의 이름 있는 파이프는 그런 보호가 없어서,
 * 같은 PC의 다른 사용자가 데몬보다 먼저 같은 이름의 파이프를 만들면 앱이 그쪽에 붙어 API 키 같은 요청을
 * 보낼 수 있었다. 그래서 데몬과 연결기가 사용자만 읽을 수 있는 토큰 파일로 서로를 확인한다.
 *
 * 순서 (JSON-RPC 앞에 한 줄씩):
 * 1. 데몬 → `{"piDesktopAuth":1,"nonce":S}`
 * 2. 연결기 → `{"nonce":C,"proof":HMAC(토큰, "client:"+S)}`
 * 3. 데몬 → `{"proof":HMAC(토큰, "server:"+C)}`. 그 뒤로는 JSON-RPC
 *
 * 토큰을 모르는 쪽은 증명을 만들 수 없다. 연결기는 데몬이 증명하기 전에는 앱의 요청을 넘기지 않는다.
 */

/** 데몬이 인사를 보내지 않으면(예전 데몬) 기다리는 시간 */
export const HELLO_WAIT_MS = 1500;
/** 인증 단계 한 줄을 기다리는 최대 시간 */
const LINE_WAIT_MS = 5000;
/** 인증 줄의 최대 길이 (이보다 길면 프로토콜이 아니다) */
const MAX_LINE = 1024;

export function tokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(runDir(env), "agentd.token");
}

export function createToken(): string {
  return randomBytes(32).toString("hex");
}

/** 토큰 파일을 사용자만 읽게 쓴다 (Windows는 사용자 프로필 폴더의 권한을 따른다). 반쯤 쓴 파일이 읽히지 않게 바꿔 넣는다. */
export async function writeToken(token: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = tokenPath(env);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, token, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(temp, 0o600);
  await rename(temp, path);
}

export async function readToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return (await readFile(tokenPath(env), "utf8")).trim();
}

export function proofFor(token: string, role: "client" | "server", nonce: string): string {
  return createHmac("sha256", token).update(`${role}:${nonce}`).digest("hex");
}

function sameProof(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * 소켓에서 한 줄을 읽는다. 줄 뒤에 붙어 온 바이트는 rest로 돌려준다 (다음 단계가 이어서 읽는다).
 * 시간 안에 줄이 오지 않으면 undefined. 데이터 리스너는 끝나면 떼어 낸다.
 */
export function readLine(socket: Socket, timeoutMs: number, initial: Buffer = Buffer.alloc(0)): Promise<{ line: string; rest: Buffer } | undefined> {
  return new Promise((resolve, reject) => {
    let buffer = initial;
    const finish = (value: { line: string; rest: Buffer } | undefined, error?: Error) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("close", onClose);
      socket.off("error", onClose);
      socket.pause();
      if (error) reject(error);
      else resolve(value);
    };
    const check = () => {
      const end = buffer.indexOf(0x0a);
      if (end >= 0) {
        finish({ line: buffer.subarray(0, end).toString("utf8").replace(/\r$/, ""), rest: buffer.subarray(end + 1) });
        return true;
      }
      if (buffer.length > MAX_LINE) finish(undefined, new Error("인증 줄이 너무 깁니다"));
      return buffer.length > MAX_LINE;
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      check();
    };
    const onClose = () => finish(undefined, new Error("인증 중에 연결이 끊겼습니다"));
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    if (check()) return;
    socket.on("data", onData);
    socket.once("close", onClose);
    socket.once("error", onClose);
    socket.resume();
  });
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 데몬 쪽 인증. 성공하면 JSON-RPC로 넘길 남은 바이트를 돌려준다.
 * 예전 연결기는 인증 없이 곧바로 JSON-RPC를 보낸다. allowLegacy(POSIX: 0700 폴더라 같은 사용자뿐)면
 * 그 줄을 첫 JSON-RPC 기록으로 넘기고, 아니면 거절한다.
 */
export async function serverHandshake(
  socket: Socket,
  token: string,
  allowLegacy: boolean,
): Promise<{ rest: Buffer; legacy: boolean }> {
  const nonce = randomBytes(16).toString("hex");
  socket.write(`${JSON.stringify({ piDesktopAuth: 1, nonce })}\n`);
  const answer = await readLine(socket, LINE_WAIT_MS);
  if (!answer) throw new Error("인증 응답이 없습니다");
  const record = parse(answer.line);
  if (record && "jsonrpc" in record) {
    if (!allowLegacy) throw new Error("인증하지 않은 연결기입니다");
    return { rest: Buffer.concat([Buffer.from(`${answer.line}\n`), answer.rest]), legacy: true };
  }
  if (!record || typeof record.nonce !== "string" || !sameProof(record.proof, proofFor(token, "client", nonce))) {
    throw new Error("인증에 실패했습니다");
  }
  socket.write(`${JSON.stringify({ proof: proofFor(token, "server", record.nonce) })}\n`);
  return { rest: answer.rest, legacy: false };
}

/**
 * 연결기 쪽 인증.
 * - verified: 데몬이 토큰으로 자신을 증명했다
 * - legacy: 인사가 없었다 (인증을 모르는 예전 데몬, 또는 그런 척하는 다른 프로그램)
 * 증명이 틀리면 오류를 던진다. 남은 바이트(rest)는 앱으로 넘길 데몬 출력이다.
 */
export async function clientHandshake(
  socket: Socket,
  token: () => Promise<string>,
  helloWaitMs = HELLO_WAIT_MS,
): Promise<{ status: "verified" | "legacy"; rest: Buffer }> {
  const hello = await readLine(socket, helloWaitMs);
  if (!hello) return { status: "legacy", rest: Buffer.alloc(0) };
  const record = parse(hello.line);
  if (!record || record.piDesktopAuth !== 1 || typeof record.nonce !== "string") {
    // 인사 대신 다른 것이 왔다: 예전 데몬이 먼저 보낸 알림 등. 그 줄도 앱으로 넘긴다.
    return { status: "legacy", rest: Buffer.concat([Buffer.from(`${hello.line}\n`), hello.rest]) };
  }
  const secret = await token().catch((error: unknown) => {
    throw new Error(`데몬 인증 토큰을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  });
  const nonce = randomBytes(16).toString("hex");
  socket.write(`${JSON.stringify({ nonce, proof: proofFor(secret, "client", record.nonce) })}\n`);
  const answer = await readLine(socket, LINE_WAIT_MS, hello.rest);
  const reply = answer ? parse(answer.line) : undefined;
  if (!answer || !reply || !sameProof(reply.proof, proofFor(secret, "server", nonce))) {
    throw new Error("Host Agent 데몬의 신원을 확인하지 못했습니다. 다른 프로그램이 같은 이름의 소켓·파이프를 쓰고 있을 수 있습니다.");
  }
  return { status: "verified", rest: answer.rest };
}
