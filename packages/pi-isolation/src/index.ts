import { resolve } from "node:path";
import { ISOLATION_HOME_ENV, isolatedPaths } from "./paths";

export { ISOLATION_HOME_ENV, isolatedPaths, isolationHome } from "./paths";

/**
 * Agent·Mate가 Pi를 띄울 때 데이터가 들어오는 길만 바꾸는 옵션 (설계 DESIGN-APPS.md §3.1).
 *
 * Pi 설정 폴더(`PI_CODING_AGENT_DIR`)는 바꾸지 않는다. 바꾸면 로그인·모델까지 갈라진다.
 * 대신 Pi 기본 폴더의 스킬·프롬프트·확장·문맥 파일을 끄고 앱 홈의 것만 올린다.
 * 꺼진 MCP와 문맥 파일은 이 패키지의 확장이 앱 홈에서 다시 읽는다.
 */

/** 이 패키지 폴더 기준 확장 진입 파일 */
export const ISOLATION_EXTENSIONS = ["extensions/mcp.ts", "extensions/context.ts"] as const;

/** Pi 내장 확장 중 다시 올릴 것. MCP 도구는 기본 노출이 codemode라 이 둘이 있어야 쓸 수 있다. 내장 MCP는 올리지 않는다 */
const BUILTIN_EXTENSIONS = ["builtin:codemode", "builtin:tool-search"];

export interface IsolationOptions {
  /** 앱 홈 (예: `~/.pi-desktop-agent`) */
  home: string;
  /** 이 패키지 폴더. 개발 중에는 워크스페이스, 설치본에서는 앱 리소스 */
  isolationDir: string;
  /** 앱의 kit 확장 진입 파일들 (절대 경로) */
  extensions: string[];
  /** 세션 폴더. 주지 않으면 `--session-dir`를 붙이지 않는다 (호출하는 쪽이 따로 정할 때) */
  sessionDir?: string;
}

export function isolationExtensionPaths(isolationDir: string): string[] {
  return ISOLATION_EXTENSIONS.map((entry) => resolve(isolationDir, entry));
}

/** `pi --mode …` 뒤에 붙일 인자 */
export function isolationArgs(options: IsolationOptions): string[] {
  const paths = isolatedPaths(options.home);
  const extensions = [...options.extensions, ...isolationExtensionPaths(options.isolationDir), ...BUILTIN_EXTENSIONS];
  return [
    ...(options.sessionDir ? ["--session-dir", options.sessionDir] : []),
    "-ns",
    "--skill",
    paths.skills,
    "-np",
    "--prompt-template",
    paths.prompts,
    "-ne",
    ...extensions.flatMap((entry) => ["-e", entry]),
    "-nc",
  ];
}

/** Pi 프로세스에 줄 환경 변수 */
export function isolationEnv(home: string): Record<string, string> {
  return { [ISOLATION_HOME_ENV]: home };
}
