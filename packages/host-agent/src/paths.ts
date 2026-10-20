import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/**
 * Host Agent가 쓰는 디렉터리. 기본은 `~/.pi-desktop`.
 * 테스트나 여러 인스턴스를 격리할 때는 `PI_DESKTOP_HOME` 환경 변수로 바꾼다.
 * Pi의 `~/.pi`와는 분리한다 (설계 §1: GUI 메타데이터는 Pi 디렉터리를 오염시키지 않음).
 */
export function agentHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_DESKTOP_HOME || join(homedir(), ".pi-desktop");
}

/** 데몬 로그 등 런타임 파일 위치 */
export function runDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentHome(env), "run");
}

/**
 * 데몬이 듣는 소켓 주소.
 * - POSIX: `<agentHome>/run/agentd.sock` (디렉터리 권한 0700으로 같은 사용자만 접근)
 * - Windows: 이름 있는 파이프. 경로를 쓸 수 없으므로 사용자 이름과 agentHome 해시로 이름을 만든다.
 */
export function socketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const hash = createHash("sha256").update(agentHome(env).toLowerCase()).digest("hex").slice(0, 12);
    return `\\\\.\\pipe\\pi-desktop-agentd-${safeUserName()}-${hash}`;
  }
  return join(runDir(env), "agentd.sock");
}

function safeUserName(): string {
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_.-]/g, "_");
  } catch {
    return "user";
  }
}
