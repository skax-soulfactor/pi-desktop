import { describe, expect, it } from "vitest";
import { availablePrompt, compareVersions, isLocalBuild, latestAgentRelease, releaseDownloadBase, UPDATE_CHANNEL, updateMode } from "../src/main/update-policy";

describe("자동 업데이트 규칙", () => {
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
    expect(latestAgentRelease(releases)).toEqual({ tag: "v0.6.10", version: "0.6.10" });
    expect(latestAgentRelease([{ tag_name: "agent-v1.0.0" }, { tag_name: "mate-v1.0.0" }])).toBeUndefined();
  });

  it("버전 비교와 내려받기 주소", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(releaseDownloadBase("o", "r", "v0.6.4")).toBe("https://github.com/o/r/releases/download/v0.6.4");
    // 한 릴리스 안에서 Pi Desktop의 latest.yml과 겹치지 않는 업데이트 정보 파일 (agent.yml)
    expect(UPDATE_CHANNEL).toBe("agent");
  });

  it("Windows·AppImage는 내려받아 설치, macOS·deb는 알리기만", () => {
    expect(updateMode("win32", {})).toBe("auto");
    expect(updateMode("linux", { APPIMAGE: "/x.AppImage" })).toBe("auto");
    expect(updateMode("linux", {})).toBe("notify");
    expect(updateMode("darwin", {})).toBe("notify");
    expect(availablePrompt("notify", "0.1.1", "0.2.0").buttons[0]).toBe("릴리스 페이지 열기");
  });

  it("로컬 빌드(0.0.1)는 시험 주소가 없으면 확인하지 않는다", () => {
    expect(isLocalBuild("0.0.1", {})).toBe(true);
    expect(isLocalBuild("0.0.1", { PI_DESKTOP_AGENT_UPDATE_URL: "http://x" })).toBe(false);
    expect(isLocalBuild("0.1.2", {})).toBe(false);
  });
});
