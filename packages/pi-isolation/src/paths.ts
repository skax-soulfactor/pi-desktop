import { join } from "node:path";

/**
 * 앱 홈 안의 Pi 데이터 위치 (설계 DESIGN-APPS.md §3).
 *
 * 확장은 대상 호스트의 Pi가 jiti로 불러오므로 이 파일은 node 내장 모듈 말고는 import하지 않는다.
 */

/** 앱이 Pi에 앱 홈을 알리는 환경 변수. 이 패키지의 확장은 이 값이 없으면 아무것도 하지 않는다 */
export const ISOLATION_HOME_ENV = "PI_ISOLATION_HOME";

export function isolationHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[ISOLATION_HOME_ENV] || undefined;
}

export function isolatedPaths(home: string) {
  return {
    home,
    sessions: join(home, "sessions"),
    skills: join(home, "skills"),
    prompts: join(home, "prompts"),
    mcp: join(home, "mcp.json"),
    mcpLog: join(home, "mcp.log"),
  };
}
