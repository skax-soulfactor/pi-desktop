import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentState, fitToDisplays, loadWindowState, trackWindowState, type Rect, type TrackedWindow } from "../src/index";

const defaults = { width: 1200, height: 820, minWidth: 720, minHeight: 480 };
const main: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const right: Rect = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("fitToDisplays — 저장된 창 상태를 지금 화면들에 맞추기", () => {
  it("저장된 값이 없거나 깨졌으면 기본 크기로, 위치는 Electron에 맡긴다", () => {
    expect(fitToDisplays(undefined, defaults, [main])).toEqual({ width: 1200, height: 820 });
    expect(fitToDisplays({ width: "큼", x: null }, defaults, [main])).toEqual({ width: 1200, height: 820 });
  });

  it("화면 안의 위치·크기·최대화는 그대로 되살린다", () => {
    expect(fitToDisplays({ x: 100, y: 50, width: 1500, height: 900, maximized: true }, defaults, [main])).toEqual({
      x: 100,
      y: 50,
      width: 1500,
      height: 900,
      maximized: true,
    });
  });

  it("크기는 최소 크기와 가장 큰 화면 사이로 맞춘다", () => {
    expect(fitToDisplays({ width: 300, height: 200 }, defaults, [main])).toMatchObject({ width: 720, height: 480 });
    expect(fitToDisplays({ width: 5000, height: 3000 }, defaults, [main])).toMatchObject({ width: 1920, height: 1040 });
    // 두 번째 화면이 더 크면 그 크기까지
    expect(fitToDisplays({ width: 2400, height: 1300 }, defaults, [main, right])).toMatchObject({ width: 2400, height: 1300 });
  });

  it("떼어 낸 모니터에 있던 창은 위치를 버린다 (크기는 남긴다)", () => {
    const saved = { x: 2100, y: 100, width: 1400, height: 900 };
    expect(fitToDisplays(saved, defaults, [main, right])).toMatchObject({ x: 2100, y: 100 });
    expect(fitToDisplays(saved, defaults, [main])).toEqual({ width: 1400, height: 900 });
  });

  it("제목줄이 화면 밖으로 올라가 있으면 위치를 버린다", () => {
    expect(fitToDisplays({ x: 100, y: -300, width: 1200, height: 820 }, defaults, [main])).toEqual({ width: 1200, height: 820 });
  });
});

/** 크기·이벤트만 흉내 내는 창 */
function fakeWindow(bounds: Rect, flags: { maximized?: boolean; minimized?: boolean; fullScreen?: boolean } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const win: TrackedWindow & { emit(event: string): void; bounds: Rect; flags: typeof flags } = {
    bounds,
    flags,
    getNormalBounds: () => win.bounds,
    isMaximized: () => Boolean(win.flags.maximized),
    isMinimized: () => Boolean(win.flags.minimized),
    isFullScreen: () => Boolean(win.flags.fullScreen),
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    emit: (event) => listeners.get(event)?.forEach((l) => l()),
  };
  return win;
}

describe("창 상태 저장", () => {
  it("최대화한 창은 최대화 전 크기와 최대화 여부를, 최소화·전체 화면은 저장하지 않는다", () => {
    expect(currentState(fakeWindow({ x: 10, y: 20, width: 1300, height: 900 }, { maximized: true }))).toEqual({
      x: 10,
      y: 20,
      width: 1300,
      height: 900,
      maximized: true,
    });
    expect(currentState(fakeWindow(main, { minimized: true }))).toBeUndefined();
    expect(currentState(fakeWindow(main, { fullScreen: true }))).toBeUndefined();
  });

  it("닫을 때 바로 저장하고, 다음 실행에서 그대로 읽는다", () => {
    const file = join(mkdtempSync(join(tmpdir(), "window-state-")), "nested", "window-state.json");
    const win = fakeWindow({ x: 200, y: 100, width: 1400, height: 950 });
    trackWindowState(win, file);
    win.emit("resize");
    win.emit("close");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ x: 200, y: 100, width: 1400, height: 950 });
    expect(loadWindowState(file, defaults, [main])).toEqual({ x: 200, y: 100, width: 1400, height: 950 });
  });

  it("파일이 깨졌으면 기본 크기로 연다", () => {
    const file = join(mkdtempSync(join(tmpdir(), "window-state-")), "window-state.json");
    writeFileSync(file, "{깨짐");
    expect(loadWindowState(file, defaults, [main])).toEqual({ width: 1200, height: 820 });
  });
});
