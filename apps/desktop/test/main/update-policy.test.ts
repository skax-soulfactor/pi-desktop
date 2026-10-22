import { describe, expect, it } from "vitest";
import { releaseUrl, updateMode } from "../../src/main/update-policy";

describe("updateMode·releaseUrl", () => {
  it("자동 설치는 Windows와 AppImage만, 그 밖은 알리기만", () => {
    expect(updateMode("win32", {})).toBe("auto");
    expect(updateMode("linux", { APPIMAGE: "/home/me/Pi.AppImage" })).toBe("auto");
    expect(updateMode("linux", {})).toBe("notify");
    expect(updateMode("darwin", {})).toBe("notify");
  });

  it("버전의 릴리스 페이지", () => {
    expect(releaseUrl("o", "r", "0.2.0")).toBe("https://github.com/o/r/releases/tag/v0.2.0");
    expect(releaseUrl("o", "r", "v0.2.0")).toBe("https://github.com/o/r/releases/tag/v0.2.0");
  });
});
