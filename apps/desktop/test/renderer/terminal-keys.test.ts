import { describe, expect, it } from "vitest";
import { clipboardKeyAction, type KeyLike } from "../../src/renderer/terminal-keys";

const key = (code: string, mods: Partial<Omit<KeyLike, "code">> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("clipboardKeyAction", () => {
  it("Windows·Linux: Ctrl+Shift+C/V는 언제나 복사·붙여넣기", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, shiftKey: true }), false, false)).toBe("copy");
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, shiftKey: true }), false, false)).toBe("paste");
  });

  it("Windows·Linux: Ctrl+C는 선택이 있을 때만 복사, 없으면 터미널로 (명령 멈춤)", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), false, true)).toBe("copy");
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), false, false)).toBeUndefined();
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true }), false, false)).toBe("paste");
  });

  it("macOS: Cmd+C/V만, Ctrl+C는 언제나 터미널로", () => {
    expect(clipboardKeyAction(key("KeyC", { metaKey: true }), true, false)).toBe("copy");
    expect(clipboardKeyAction(key("KeyV", { metaKey: true }), true, false)).toBe("paste");
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), true, true)).toBeUndefined();
  });

  it("다른 키·Alt 조합은 건드리지 않는다", () => {
    expect(clipboardKeyAction(key("KeyD", { ctrlKey: true }), false, true)).toBeUndefined();
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, altKey: true }), false, false)).toBeUndefined();
    expect(clipboardKeyAction(key("KeyC"), false, true)).toBeUndefined();
  });
});
