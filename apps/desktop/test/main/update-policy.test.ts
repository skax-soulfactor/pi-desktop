import { describe, expect, it } from "vitest";
import { isLocalBuild, releaseUrl, updateMode } from "../../src/main/update-policy";

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

  it("저장소 버전 그대로인 로컬 빌드는 업데이트를 확인하지 않는다 (업데이트 시험 주소가 있으면 예외)", () => {
    expect(isLocalBuild("0.0.1", {})).toBe(true);
    expect(isLocalBuild("0.0.1", { PI_DESKTOP_UPDATE_URL: "http://localhost:8080" })).toBe(false);
    expect(isLocalBuild("0.1.3", {})).toBe(false);
  });
});
