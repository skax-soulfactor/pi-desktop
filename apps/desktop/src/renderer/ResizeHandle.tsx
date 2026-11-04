import { useEffect, useRef, type PointerEvent } from "react";

/**
 * 옆 창 너비를 끌어서 바꾸는 손잡이. 옆 창과 본문 사이(flex 줄)에 둔다.
 * 너비는 CSS 변수(cssVar)로 문서 맨 위에 걸고 이 기기의 localStorage에 기억한다. 두 번 누르면 기본 너비로 돌아간다.
 * 좁은 화면(서랍으로 바뀌는 720px 이하)에서는 CSS가 손잡이를 감춘다.
 * Pi Desktop의 세션 목록·대화 나무, Agent의 옆 메뉴가 함께 쓴다.
 */
export interface ResizeHandleProps {
  /** localStorage 키 */
  storageKey: string;
  /** 너비를 담는 CSS 변수 (예: --sidebar-width) */
  cssVar: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** 옆 창이 손잡이의 어느 쪽에 있는가 (오른쪽 창은 왼쪽으로 끌면 넓어진다) */
  side?: "left" | "right";
  label: string;
}

function readWidth(key: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function apply(cssVar: string, width: number | undefined): void {
  if (width === undefined) document.documentElement.style.removeProperty(cssVar);
  else document.documentElement.style.setProperty(cssVar, `${Math.round(width)}px`);
}

export function ResizeHandle({ storageKey, cssVar, defaultWidth, min, max, side = "left", label }: ResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | undefined>(undefined);
  const clamp = (w: number) => Math.min(max, Math.max(min, w));

  useEffect(() => {
    const saved = readWidth(storageKey);
    if (saved !== undefined) apply(cssVar, clamp(saved));
  }, [storageKey, cssVar]);

  const current = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : defaultWidth;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const width = current();
    drag.current = { startX: e.clientX, startWidth: width, width };
    document.body.classList.add("resizing-columns");
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    state.width = clamp(state.startWidth + (side === "left" ? dx : -dx));
    apply(cssVar, state.width);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    drag.current = undefined;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing-columns");
    try {
      localStorage.setItem(storageKey, String(Math.round(state.width)));
    } catch {
      // 기억하지 못해도 지금 너비는 그대로 쓴다
    }
  };

  const reset = () => {
    apply(cssVar, undefined);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 무시
    }
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (끌어서 바꾸고, 두 번 누르면 처음 너비)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
    />
  );
}
