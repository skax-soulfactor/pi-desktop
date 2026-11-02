import { afterEach, describe, expect, it, vi } from "vitest";
import { enterHint, isSendKey, isWebClient, touchTyping } from "../../src/renderer/clipboard-images";

/** 화면 환경을 흉내 낸다: 웹 버전 표시(data-client)와 터치 화면 여부 */
function screen(opts: { web: boolean; coarse: boolean }) {
  vi.stubGlobal("document", { documentElement: { dataset: opts.web ? { client: "web" } : {} } });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && opts.coarse }));
}

const enter = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false };

describe("휴대폰 전용 동작은 웹 버전에서만", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Electron 앱은 터치 노트북(pointer: coarse)이어도 Enter로 보낸다", () => {
    screen({ web: false, coarse: true });
    expect(isWebClient()).toBe(false);
    expect(touchTyping()).toBe(false);
    expect(isSendKey(enter)).toBe(true);
    expect(enterHint("Enter 전송, Shift+Enter 줄바꿈")).toBe("Enter 전송, Shift+Enter 줄바꿈");
  });

  it("휴대폰 웹 버전의 터치 화면은 Enter가 줄바꿈이고, Ctrl+Enter로 보낸다", () => {
    screen({ web: true, coarse: true });
    expect(touchTyping()).toBe(true);
    expect(isSendKey(enter)).toBe(false);
    expect(isSendKey({ ...enter, ctrlKey: true })).toBe(true);
    expect(enterHint("Enter 전송, Shift+Enter 줄바꿈")).toBe("Enter 줄바꿈, 보내기 버튼으로 전송");
  });

  it("웹 버전이라도 마우스 화면은 Enter로 보낸다", () => {
    screen({ web: true, coarse: false });
    expect(isSendKey(enter)).toBe(true);
  });
});
