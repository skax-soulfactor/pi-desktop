import { describe, expect, it } from "vitest";
import { copyWarnings, isAlreadyExists } from "../../src/renderer/copy-view";

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
