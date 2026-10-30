import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkCommand } from "../../src/guard";
import { isGuardProfile, MATE_ENV, profileTools } from "../../src/shared";
import { writeScopeError } from "../../src/write-scope";

/** Windows Git Bash 출력이 UTF-8로 오도록 (Pi Desktop bridge와 같은 처리, Mate는 bridge를 쓰지 않는다) */
const UTF8_PREFIX = "chcp.com 65001 > /dev/null 2>&1";

/**
 * 권한 단계 강제 (설계 DESIGN-MATE.md §4).
 *
 * 실행기가 `--tools`로 단계에 없는 도구를 아예 선언하지 않지만, 여기서 한 번 더 막는다:
 * - 단계에 없는 도구 호출은 막는다 (다른 확장이 더한 도구 포함)
 * - bash는 어느 단계든 읽기 전용 허용 목록만
 * - act의 write·edit는 작업 공간(git worktree) 안만. 작업 공간이 주어지지 않았으면 막는다
 * 권한 단계 환경 변수가 없으면(터미널 pi에 설치) 아무것도 하지 않는다.
 */
export default function mateGuard(pi: ExtensionAPI): void {
  const profile = process.env[MATE_ENV.profile];
  if (!isGuardProfile(profile)) return;
  const allowed = new Set(profileTools(profile));
  const writeRoot = process.env[MATE_ENV.writeRoot];

  pi.on("tool_call", async (event, ctx) => {
    if (!allowed.has(event.toolName)) {
      return { block: true, reason: `Mate의 ${profile} 단계에서는 ${event.toolName} 도구를 쓸 수 없습니다` };
    }
    if (event.toolName === "write" || event.toolName === "edit") {
      if (!writeRoot) return { block: true, reason: "작업 공간이 없어 파일을 쓸 수 없습니다" };
      const path = String((event.input as { path?: unknown }).path ?? "");
      const error = writeScopeError(path, ctx?.cwd ?? process.cwd(), writeRoot);
      return error ? { block: true, reason: error } : undefined;
    }
    if (event.toolName !== "bash") return undefined;
    const input = event.input as { command?: unknown };
    const command = String(input.command ?? "");
    const verdict = checkCommand(command);
    if (!verdict.allowed) {
      return { block: true, reason: `읽기 전용 명령만 실행할 수 있습니다: ${verdict.reason}` };
    }
    if (process.platform === "win32" && !command.startsWith(UTF8_PREFIX)) input.command = `${UTF8_PREFIX}\n${command}`;
    return undefined;
  });
}
