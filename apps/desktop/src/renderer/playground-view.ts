/**
 * SDK Playground 화면의 순수 함수와 예제 (설계 §4.10).
 */

export interface PlaygroundExample {
  title: string;
  code: string;
}

/** 처음 열 때와 "예제"에서 고르는 스크립트. 스크립트 앞에 `const pi = await import(<Pi SDK>)`가 붙는다 */
export const EXAMPLES: PlaygroundExample[] = [
  {
    title: "SDK가 내놓는 것",
    code: [
      "// 이 호스트에 설치된 Pi SDK(pi)가 내놓는 이름들",
      "console.log(Object.keys(pi).sort().join(\"\\n\"));",
    ].join("\n"),
  },
  {
    title: "최근 세션 5개",
    code: [
      "// 모든 폴더의 세션을 최근 수정 순으로 (세션 폴더를 환경 변수로 바꿨으면 그곳을 본다)",
      "const sessions = await pi.SessionManager.listAll(process.env.PI_CODING_AGENT_SESSION_DIR);",
      "sessions.sort((a, b) => b.modified - a.modified);",
      "console.log(`세션 ${sessions.length}개`);",
      "for (const s of sessions.slice(0, 5)) {",
      "  console.log(s.modified.toISOString(), s.cwd, (s.firstMessage || \"\").slice(0, 60));",
      "}",
    ].join("\n"),
  },
  {
    title: "사용자 설정 읽기",
    code: [
      "// 작업 폴더 기준으로 Pi가 보는 설정 (사용자 + 프로젝트)",
      "const settings = pi.SettingsManager.create(process.cwd());",
      "console.log(JSON.stringify(settings.getSettings(), null, 2));",
    ].join("\n"),
  },
];

export interface OutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

/** 이어 온 같은 종류의 출력을 하나로 붙인다 (화면에 그릴 조각 수를 줄인다) */
export function appendOutput(chunks: readonly OutputChunk[], next: OutputChunk): OutputChunk[] {
  const last = chunks.at(-1);
  if (last && last.stream === next.stream) return [...chunks.slice(0, -1), { stream: last.stream, text: last.text + next.text }];
  return [...chunks, next];
}

/** 실행 결과 한 줄 */
export function resultText(result: { exitCode: number | null; signal?: string; durationMs: number; timedOut: boolean; truncated: boolean }): string {
  const seconds = (result.durationMs / 1000).toFixed(result.durationMs < 10_000 ? 2 : 1);
  const how = result.timedOut
    ? "제한 시간을 넘어 멈춤"
    : result.exitCode === null
      ? `멈춤${result.signal ? ` (${result.signal})` : ""}`
      : `종료 코드 ${result.exitCode}`;
  return `${how} · ${seconds}초${result.truncated ? " · 출력이 너무 많아 잘림" : ""}`;
}

/** 편집기에서 Tab은 공백 두 칸으로: 바뀐 글과 커서 위치 */
export function insertIndent(text: string, start: number, end: number): { text: string; cursor: number } {
  return { text: `${text.slice(0, start)}  ${text.slice(end)}`, cursor: start + 2 };
}
