import { describe, expect, it } from "vitest";
import { compareVersions, isLocalBuild, latestMateRelease, releaseDownloadBase, UPDATE_CHANNEL, updateMode } from "../../src/main/update-policy";

describe("Mate 업데이트 규칙", () => {
  it("세 앱을 함께 올린 릴리스(v*) 중 가장 높은 것을 고른다 (옛 agent-v*·mate-v*, 초안·사전 릴리스 제외)", () => {
    const releases = [
      { tag_name: "agent-v0.6.4" },
      { tag_name: "mate-v0.6.4" },
      { tag_name: "v0.6.3", html_url: "u1" },
      { tag_name: "v0.6.10" },
      { tag_name: "v0.7.0", draft: true },
      { tag_name: "v0.8.0", prerelease: true },
      { tag_name: "v0.6.4" },
    ];
    expect(latestMateRelease(releases)).toEqual({ tag: "v0.6.10", version: "0.6.10" });
    expect(latestMateRelease([{ tag_name: "agent-v1.0.0" }, { tag_name: "mate-v1.0.0" }])).toBeUndefined();
  });

  it("버전 비교는 숫자로 (0.10 > 0.9)", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("v0.1.0", "0.2.0")).toBeLessThan(0);
  });

  it("내려받기 주소·자동 설치 여부·로컬 빌드", () => {
    expect(releaseDownloadBase("o", "r", "v0.6.4")).toBe("https://github.com/o/r/releases/download/v0.6.4");
    expect(UPDATE_CHANNEL).toBe("mate");
    expect(updateMode("win32", {})).toBe("auto");
    expect(updateMode("linux", { APPIMAGE: "/a.AppImage" })).toBe("auto");
    expect(updateMode("linux", {})).toBe("notify");
    expect(updateMode("darwin", {})).toBe("notify");
    expect(isLocalBuild("0.0.1", {})).toBe(true);
    expect(isLocalBuild("0.0.1", { PI_DESKTOP_MATE_UPDATE_URL: "http://127.0.0.1:1/" })).toBe(false);
    expect(isLocalBuild("0.2.0", {})).toBe(false);
  });
});
