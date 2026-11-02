import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 창 크기·위치·최대화를 기억했다가 다음 실행 때 되살린다 (Pi Desktop·Agent·Mate가 함께 쓴다).
 *
 * - 저장: 크기를 바꾸거나 옮기면 잠시 모았다가, 창을 닫을 때는 바로 앱 데이터 폴더의 JSON에 쓴다.
 *   최대화한 창은 최대화 전 크기(getNormalBounds)와 최대화 여부를 저장한다. 최소화·전체 화면은 저장하지 않는다.
 * - 되살리기: 저장된 위치가 지금 화면들 밖이면(모니터를 뗐을 때 등) 위치는 버리고 크기만 쓴다 (Electron이 가운데에 둔다).
 *   크기는 최소 크기와 가장 큰 화면 사이로 맞춘다.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** 위치가 없으면 Electron이 화면 가운데에 둔다 */
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface WindowDefaults {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** 저장된 위치를 쓰려면 창 윗부분(제목줄)이 화면 안에 이만큼은 보여야 한다 */
const VISIBLE_WIDTH = 120;
const VISIBLE_HEIGHT = 40;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * 저장된 값을 지금 화면들에 맞게 고친다. 저장된 값이 없거나 깨졌으면 기본 크기를 쓴다.
 * @param workAreas 화면들의 작업 영역 (작업 표시줄을 뺀 영역, Electron screen.getAllDisplays()의 workArea)
 */
export function fitToDisplays(saved: unknown, defaults: WindowDefaults, workAreas: readonly Rect[]): WindowState {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof WindowState, unknown>>;
  const maxWidth = Math.max(defaults.minWidth, ...workAreas.map((a) => a.width));
  const maxHeight = Math.max(defaults.minHeight, ...workAreas.map((a) => a.height));
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    Math.round(Math.min(Math.max(isNumber(value) ? value : fallback, min), max));
  const state: WindowState = {
    width: clamp(s.width, defaults.width, defaults.minWidth, maxWidth),
    height: clamp(s.height, defaults.height, defaults.minHeight, maxHeight),
  };
  if (s.maximized === true) state.maximized = true;
  if (isNumber(s.x) && isNumber(s.y)) {
    const titleBar: Rect = { x: s.x, y: s.y, width: state.width, height: VISIBLE_HEIGHT };
    const visible = workAreas.some((area) => {
      const o = overlap(titleBar, area);
      return o.width >= Math.min(VISIBLE_WIDTH, state.width) && o.height >= Math.min(VISIBLE_HEIGHT, titleBar.height);
    });
    if (visible) {
      state.x = Math.round(s.x);
      state.y = Math.round(s.y);
    }
  }
  return state;
}

/** 저장된 창 상태를 읽어 지금 화면들에 맞춘다. 파일이 없거나 깨졌으면 기본 크기 */
export function loadWindowState(file: string, defaults: WindowDefaults, workAreas: readonly Rect[]): WindowState {
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    saved = undefined;
  }
  return fitToDisplays(saved, defaults, workAreas);
}

/** 창 상태를 저장한다. 실패해도 앱 동작에는 지장이 없으므로 조용히 넘어간다 */
export function saveWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state)}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    // 저장하지 못하면 다음 실행에서 기본 크기로 연다
  }
}

/** trackWindowState가 쓰는 창의 일부 (Electron BrowserWindow) */
export interface TrackedWindow {
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
  on(event: "resize" | "move" | "maximize" | "unmaximize" | "close", listener: () => void): unknown;
}

/** 지금 창 상태. 최소화·전체 화면이면 저장하지 않는다 (undefined) */
export function currentState(win: TrackedWindow): WindowState | undefined {
  if (win.isMinimized() || win.isFullScreen()) return undefined;
  const bounds = win.getNormalBounds();
  return { ...bounds, ...(win.isMaximized() ? { maximized: true } : {}) };
}

/** 창 크기·위치가 바뀔 때마다 저장한다. 닫을 때는 기다리지 않고 바로 저장한다 */
export function trackWindowState(win: TrackedWindow, file: string, delayMs = 500): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const state = currentState(win);
    if (state) saveWindowState(file, state);
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, delayMs);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"] as const) win.on(event, later);
  win.on("close", save);
}
