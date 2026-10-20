import { describe, expect, it } from "vitest";
import type { FileChange } from "../src/file-watcher";
import { ExternalWriteDetector, type WatchFn } from "../src/external-write";

const MESSAGE_LINE = '{"type":"message","id":"x","message":{"role":"user","content":"hi"}}\n';
const USAGE_LINE = '{"type":"usage","id":"u","kind":"cache_warm"}\n';

/**
 * 가짜 파일: 내용을 덧붙이면 감시자에게 크기·수정 시각과 함께 알린다.
 */
function setup(graceMs = 3000) {
  let clock = 1000;
  let content = "";
  const listeners = new Map<string, (change: FileChange) => void>();
  const watcher: WatchFn = {
    watch(path, listener) {
      listeners.set(path, listener);
      return () => listeners.delete(path);
    },
  };
  const detections: Array<[string, number]> = [];
  const detector = new ExternalWriteDetector(
    watcher,
    (p, at) => detections.push([p, at]),
    graceMs,
    () => clock,
    async (_path, from, to) => content.slice(from, to),
  );
  const append = async (path: string, text: string) => {
    content += text;
    listeners.get(path)?.({ path, size: content.length, modified: clock });
    await detector.idle();
  };
  const advance = (ms: number) => (clock += ms);
  return { detector, detections, listeners, append, advance };
}

describe("ExternalWriteDetector", () => {
  it("우리 Pi가 막 활동한 직후 덧붙은 메시지는 우리가 쓴 것으로 본다", async () => {
    const { detector, detections, append, advance } = setup();
    detector.track("/s.jsonl");
    advance(5000);
    detector.activity();
    advance(1000);
    await append("/s.jsonl", MESSAGE_LINE);
    expect(detections).toEqual([]);
  });

  it("감시가 늦게 알아채도(감지 시각이 아니라 파일 수정 시각으로 판단) 오탐하지 않는다", async () => {
    const { detector, detections, append, advance } = setup(800);
    detector.track("/s.jsonl");
    advance(5000);
    detector.activity();
    advance(100);
    // 수정 시각은 활동 100ms 뒤. 알림이 1초 늦게 오더라도 수정 시각 기준이므로 우리 쓰기다.
    await append("/s.jsonl", MESSAGE_LINE);
    advance(1000);
    expect(detections).toEqual([]);
  });

  it("우리 Pi가 조용한데 메시지가 덧붙으면 다른 프로그램이 쓴 것으로 한 번만 알린다", async () => {
    const { detector, detections, append, advance } = setup();
    detector.track("/s.jsonl");
    advance(5000);
    await append("/s.jsonl", MESSAGE_LINE);
    await append("/s.jsonl", MESSAGE_LINE);
    expect(detections).toEqual([["/s.jsonl", 6000]]);
    expect(detector.detectedAt).toBe(6000);
  });

  it("메시지가 아닌 항목(사용량 기록 등)만 덧붙으면 감지하지 않는다", async () => {
    const { detector, detections, append, advance } = setup();
    detector.track("/s.jsonl");
    advance(5000);
    await append("/s.jsonl", USAGE_LINE);
    expect(detections).toEqual([]);
  });

  it("clear 뒤에는 다시 감지할 수 있다", async () => {
    const { detector, detections, append, advance } = setup();
    detector.track("/s.jsonl");
    advance(5000);
    await append("/s.jsonl", MESSAGE_LINE);
    detector.clear();
    expect(detector.detectedAt).toBeUndefined();
    advance(5000);
    await append("/s.jsonl", MESSAGE_LINE);
    expect(detections).toHaveLength(2);
  });

  it("세션 파일이 바뀌면(fork·clone) 새 파일을 감시하고 표시를 지운다. 옛 파일 변경은 무시한다", async () => {
    const { detector, detections, listeners, append, advance } = setup();
    detector.track("/old.jsonl");
    advance(5000);
    await append("/old.jsonl", MESSAGE_LINE);
    expect(detector.detectedAt).toBeDefined();

    detector.track("/new.jsonl", 0);
    expect(detector.detectedAt).toBeUndefined();
    expect(listeners.has("/old.jsonl")).toBe(false);
    advance(5000);
    await append("/old.jsonl", MESSAGE_LINE);
    expect(detections).toHaveLength(1);
    await append("/new.jsonl", MESSAGE_LINE);
    expect(detections.at(-1)?.[0]).toBe("/new.jsonl");
  });

  it("dispose하면 감시를 멈춘다", () => {
    const { detector, listeners } = setup();
    detector.track("/s.jsonl");
    detector.dispose();
    expect(listeners.size).toBe(0);
  });
});
