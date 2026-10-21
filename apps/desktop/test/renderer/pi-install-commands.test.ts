import { describe, expect, it } from "vitest";
import {
  installSteps,
  isVersion,
  stableVersionsNewestFirst,
  uninstallStep,
  versionInstallStep,
} from "../../src/renderer/pi-install-commands";

describe("installSteps", () => {
  it("Windows: npm.cmd로 전역 설치, Node가 부족하면 winget 단계를 먼저", () => {
    expect(installSteps("win32", true).map((s) => s.command)).toEqual([
      "npm.cmd install -g --ignore-scripts @earendil-works/pi-coding-agent",
    ]);
    expect(installSteps("win32", false).map((s) => s.id)).toEqual(["node", "install"]);
  });

  it("Linux·macOS: 설치기를 먼저 내려받아 보여주고 그다음 실행", () => {
    const steps = installSteps("linux", true);
    expect(steps.map((s) => s.id)).toEqual(["view", "install"]);
    expect(steps[0]!.command).toContain("curl -fsSL https://pi.dev/install.sh");
    expect(steps[0]!.command).toContain("less");
    expect(steps[1]!.command).toBe('sh "$HOME/.pi-desktop/pi-install.sh"');
  });
});

describe("versionInstallStep", () => {
  it("npm 전역만, 버전 형식만 받는다", () => {
    expect(versionInstallStep("win32", "npm-global", "1.2.0")?.command).toBe(
      "npm.cmd install -g --ignore-scripts @earendil-works/pi-coding-agent@1.2.0",
    );
    expect(versionInstallStep("linux", "managed", "1.2.0")).toBeUndefined();
    expect(versionInstallStep("linux", "npm-global", "1.2.0; rm -rf ~")).toBeUndefined();
  });

  it("버전 형식", () => {
    expect(["1.3.0", "1.2.0-beta.15"].every(isVersion)).toBe(true);
    expect(["latest", "1.3", "1.3.0 && x"].some(isVersion)).toBe(false);
  });
});

describe("uninstallStep", () => {
  it("npm 전역은 npm uninstall, 관리형은 설치기, 그 밖은 없음", () => {
    expect(uninstallStep("linux", "npm-global")?.command).toBe("npm uninstall -g @earendil-works/pi-coding-agent");
    expect(uninstallStep("linux", "managed")?.command).toContain('sh "$HOME/.pi-desktop/pi-install.sh"');
    expect(uninstallStep("win32", "env")).toBeUndefined();
    expect(uninstallStep("linux", undefined)).toBeUndefined();
  });
});

describe("stableVersionsNewestFirst", () => {
  it("프리릴리스를 빼고 최신부터", () => {
    expect(stableVersionsNewestFirst(["1.0.4", "1.10.0", "1.2.0-beta.1", "1.9.0", "0.73.1"])).toEqual(["1.10.0", "1.9.0", "1.0.4", "0.73.1"]);
  });
});
