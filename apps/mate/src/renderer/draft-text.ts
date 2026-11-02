import { useCallback, useRef, useState } from "react";

/**
 * 입력창에 쓰던 글(초안)을 이름(key)마다 보관한다. 다른 화면·다른 대화에 갔다 와도 그대로 남는다 (Pi Desktop과 같은 방식).
 * - key가 바뀌면 그 key로 보관한 글을 바로 읽는다 (대화를 바꾸면 그 대화의 초안).
 * - key가 없을 때 쓴 글(새 대화를 여는 중에 채운 예시 등)은 다음에 생기는 key로 옮긴다.
 * - 보관은 이 기기의 localStorage. 저장하지 못해도 입력은 계속된다.
 */
export function useDraftText(key: string | undefined): [string, (update: string | ((prev: string) => string)) => void] {
  const [state, setState] = useState(() => ({ key, text: loadDraft(key) }));
  const keyRef = useRef(key);
  keyRef.current = key;

  let current = state;
  if (state.key !== key) {
    // key가 없을 때 쓴 글은 새 key로 옮기고, 아니면 새 key의 초안을 읽는다
    const carried = state.key === undefined && state.text ? state.text : undefined;
    current = { key, text: carried ?? loadDraft(key) };
    if (carried) saveDraft(key, carried);
    setState(current);
  }

  const setText = useCallback((update: string | ((prev: string) => string)) => {
    setState((prev) => {
      const key = keyRef.current;
      const base = prev.key === key ? prev.text : loadDraft(key);
      const text = typeof update === "function" ? update(base) : update;
      saveDraft(key, text);
      return { key, text };
    });
  }, []);

  return [current.text, setText];
}

function loadDraft(key: string | undefined): string {
  if (!key) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(key: string | undefined, text: string): void {
  if (!key) return;
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // 저장하지 못해도 입력은 계속된다
  }
}
