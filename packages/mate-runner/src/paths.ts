import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Mate의 데이터 홈. 기본은 `~/.pi-desktop-mate` (설계 DESIGN-MATE.md §2.2).
 * Pi Desktop(`~/.pi-desktop`)·Agent(`~/.pi-desktop-agent`)와 나눈다. 테스트·개발에서는 `MATE_HOME`으로 바꾼다.
 */
export function mateHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.MATE_HOME || join(homedir(), ".pi-desktop-mate");
}

export function matePaths(home: string) {
  return {
    home,
    config: join(home, "config.json"),
    duties: join(home, "duties"),
    requests: join(home, "requests"),
    state: join(home, "state.json"),
    runs: join(home, "runs"),
    inbox: join(home, "inbox.jsonl"),
    inboxState: join(home, "inbox-state.json"),
    sessions: join(home, "sessions"),
    runDir: join(home, "run"),
    pid: join(home, "run", "mated.pid"),
    log: join(home, "run", "mated.log"),
  };
}

export type MatePaths = ReturnType<typeof matePaths>;
