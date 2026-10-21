import { describe, expect, it } from "vitest";
import {
  baseNameOf,
  copyWarnings,
  isAlreadyExists,
  isLocalPathSource,
  joinHostPath,
  packageInstallArgs,
} from "../../src/renderer/copy-view";

const files = [{ path: "SKILL.md" }, { path: "scripts/run.sh" }, { path: "scripts/setup.ps1" }, { path: "a.py" }];

describe("copyWarnings", () => {
  it("대상 OS에서 돌지 않을 스크립트를 알린다", () => {
    expect(copyWarnings(files, "win32")).toEqual([expect.stringContaining("scripts/run.sh")]);
    expect(copyWarnings(files, "linux")).toEqual([expect.stringContaining("scripts/setup.ps1")]);
    expect(copyWarnings(files, "android")).toEqual([expect.stringContaining("android")]);
  });

  it("OS를 모르거나 해당 스크립트가 없으면 경고가 없다", () => {
    expect(copyWarnings(files, undefined)).toEqual([]);
    expect(copyWarnings([{ path: "SKILL.md" }], "win32")).toEqual([]);
  });
});

describe("isAlreadyExists", () => {
  it("데몬의 이미 있음 오류를 알아본다", () => {
    expect(isAlreadyExists("이미 있는 스킬입니다: /x")).toBe(true);
    expect(isAlreadyExists("파일이 너무 많습니다")).toBe(false);
  });
});

describe("isLocalPathSource·packageInstallArgs", () => {
  it("로컬 경로 소스를 알아보고, 그 밖은 같은 소스로 설치 인자를 만든다", () => {
    for (const local of ["./pkg", "../pkg", "/opt/pkg", "~/pkg", "C:\\pkg", ".\\pkg", "file:../x"]) expect(isLocalPathSource(local)).toBe(true);
    for (const remote of ["npm:pi-tools", "npm:@x/y@1.0.0", "git:github.com/x/y@v1", "https://github.com/x/y"]) {
      expect(isLocalPathSource(remote)).toBe(false);
    }
    expect(packageInstallArgs("npm:pi-tools", "user")).toEqual(["install", "npm:pi-tools"]);
    expect(packageInstallArgs("git:github.com/x/y", "project")).toEqual(["install", "git:github.com/x/y", "-l"]);
    expect(() => packageInstallArgs("./pkg", "user")).toThrow("로컬 경로");
  });
});

describe("baseNameOf·joinHostPath", () => {
  it("구분자와 상관없이 이름을 얻고, 대상 OS 구분자로 잇는다", () => {
    expect(baseNameOf("C:\\Users\\me\\.pi\\agent\\AGENTS.md")).toBe("AGENTS.md");
    expect(baseNameOf("/home/me/.pi/agent/APPEND_SYSTEM.md")).toBe("APPEND_SYSTEM.md");
    expect(joinHostPath("/home/me/.pi/agent", "AGENTS.md", "linux")).toBe("/home/me/.pi/agent/AGENTS.md");
    expect(joinHostPath("C:\\Users\\me\\.pi\\agent", "AGENTS.md", "win32")).toBe("C:\\Users\\me\\.pi\\agent\\AGENTS.md");
  });
});
