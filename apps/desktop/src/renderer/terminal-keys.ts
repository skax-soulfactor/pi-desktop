/**
 * 내장 터미널의 복사·붙여넣기 단축키 (설계 §4.12). 화면과 분리한 순수 함수.
 *
 * - Windows·Linux: Ctrl+Shift+C/V, 그리고 선택한 글이 있을 때의 Ctrl+C와 Ctrl+V (Windows Terminal·VS Code와 같다).
 *   선택이 없으면 Ctrl+C는 그대로 터미널에 보내 실행 중인 명령을 멈춘다.
 * - macOS: Cmd+C/V. Ctrl+C는 언제나 터미널에 보낸다.
 * - 한글 입력 중에도 맞도록 e.key 대신 물리 키(e.code)를 본다.
 */

export type ClipboardKeyAction = "copy" | "paste";

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function clipboardKeyAction(e: KeyLike, mac: boolean, hasSelection: boolean): ClipboardKeyAction | undefined {
  if (e.altKey) return undefined;
  const key = e.code === "KeyC" ? "c" : e.code === "KeyV" ? "v" : undefined;
  if (!key) return undefined;
  if (mac) {
    if (!e.metaKey || e.ctrlKey || e.shiftKey) return undefined;
    return key === "c" ? "copy" : "paste";
  }
  if (!e.ctrlKey || e.metaKey) return undefined;
  if (key === "v") return "paste";
  return e.shiftKey || hasSelection ? "copy" : undefined;
}
