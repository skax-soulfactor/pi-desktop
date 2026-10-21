/**
 * 입력창 규칙 (설계 §4.1 입력창). 화면과 분리한 순수 함수.
 */

/** 입력창 내용을 Pi에 보낼 명령으로 해석한 결과 */
export type ParsedInput =
  | { kind: "prompt"; message: string }
  /** `!명령`은 결과를 다음 질문의 컨텍스트에 넣고, `!!명령`은 넣지 않는다 (TUI와 같은 규칙) */
  | { kind: "bash"; command: string; excludeFromContext: boolean }
  | { kind: "empty" };

export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  if (trimmed.startsWith("!")) {
    const excludeFromContext = trimmed.startsWith("!!");
    const command = trimmed.slice(excludeFromContext ? 2 : 1).trim();
    return command ? { kind: "bash", command, excludeFromContext } : { kind: "empty" };
  }
  return { kind: "prompt", message: trimmed };
}

/** Pi `get_commands`의 명령 하나 (확장 명령, 프롬프트 템플릿, 스킬) */
export interface PiCommand {
  name: string;
  description?: string;
  source: string;
}

/**
 * `/`로 시작하는 첫 단어를 치는 중이면 그 단어(슬래시 뒤)를 돌려준다. 자동완성을 띄울지 판단할 때 쓴다.
 * 공백이나 줄바꿈이 나오면 이미 인자를 입력하는 중이므로 띄우지 않는다.
 */
export function slashQuery(text: string): string | undefined {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1] : undefined;
}

/** 이름이 검색어로 시작하는 명령을 먼저, 이름이나 설명에 들어 있는 명령을 다음에 둔다. */
export function filterCommands(commands: readonly PiCommand[], query: string, limit = 12): PiCommand[] {
  const q = query.toLowerCase();
  const byName = (a: PiCommand, b: PiCommand) => a.name.localeCompare(b.name);
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(q)).sort(byName);
  const contains = commands
    .filter((c) => !prefix.includes(c) && `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q))
    .sort(byName);
  return [...prefix, ...contains].slice(0, limit);
}

export const HISTORY_LIMIT = 100;

/** 보낸 입력을 히스토리 끝에 넣는다. 바로 앞과 같으면 다시 넣지 않는다. */
export function pushHistory(history: readonly string[], entry: string): string[] {
  const text = entry.trim();
  if (!text || history.at(-1) === text) return [...history];
  return [...history, text].slice(-HISTORY_LIMIT);
}

/**
 * ↑(-1)·↓(+1)로 히스토리를 오간다. `index`가 `history.length`면 "지금 쓰던 초안" 자리다.
 * 움직일 수 없으면 undefined.
 */
export function stepHistory(history: readonly string[], index: number, step: -1 | 1): number | undefined {
  const next = index + step;
  if (next < 0 || next > history.length) return undefined;
  return next;
}

/**
 * ↑·↓를 히스토리 이동으로 쓸지. 여러 줄을 쓰는 중에는 커서가 첫 줄(↑)이나 마지막 줄(↓)에 있을 때만 쓴다.
 * 그래야 여러 줄 편집에서 위아래 이동을 방해하지 않는다.
 */
export function shouldNavigateHistory(text: string, caret: number, step: -1 | 1): boolean {
  return step < 0 ? !text.slice(0, caret).includes("\n") : !text.slice(caret).includes("\n");
}

/**
 * 커서 바로 앞의 `@낱말`(파일 피커 검색어)을 찾는다. `@`는 글 맨 앞이거나 공백 뒤여야 한다
 * (이메일 주소 등은 건드리지 않는다). 따옴표로 시작한 경로(`@"a b`)도 이어서 친다.
 */
export function atQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const match = /(^|\s)@("[^"\n]*|[^\s"]*)$/.exec(before);
  if (!match) return undefined;
  const token = match[2]!;
  return { start: before.length - token.length - 1, query: token.replace(/^"/, "") };
}

/** 파일 피커에서 고른 경로를 넣을 글. 공백이 있으면 따옴표로 감싼다. 폴더(끝이 "/")면 이어서 고를 수 있게 공백을 붙이지 않는다 */
export function fileMention(path: string): string {
  const quoted = /\s/.test(path) ? `"${path}"` : path;
  return path.endsWith("/") ? `@${quoted}`.replace(/"$/, "") : `@${quoted} `;
}

/** text의 [start, end)를 insert로 바꾸고 새 커서 위치를 돌려준다 */
export function replaceRange(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
