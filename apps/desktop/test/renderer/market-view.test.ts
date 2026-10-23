import { describe, expect, it } from "vitest";
import {
  excludeKindsFilter,
  filterForPlatform,
  packageFilterOf,
  formatCount,
  importName,
  installArgs,
  isPinned,
  npmNameOfSource,
  removeArgs,
  scriptFiles,
  splitFrontmatter,
  updateArgs,
  commandSource,
} from "../../src/renderer/market-view";

describe("installArgs", () => {
  it("버전이 없으면 최신을 따라가고, 있으면 고정하며, 프로젝트면 -l", () => {
    expect(installArgs("pi-tools", undefined, "user")).toEqual(["install", "npm:pi-tools"]);
    expect(installArgs("@x/pi-tools", "2.0.0", "project")).toEqual(["install", "npm:@x/pi-tools@2.0.0", "-l"]);
  });

  it("이름·버전 형식이 아니면 명령을 만들지 않는다", () => {
    expect(() => installArgs("x; rm", undefined, "user")).toThrow("npm 패키지 이름");
    expect(() => installArgs("-g", undefined, "user")).toThrow("npm 패키지 이름");
    expect(() => installArgs("ok", "latest && x", "user")).toThrow("버전");
  });
});

describe("removeArgs·updateArgs", () => {
  it("설정에 적힌 소스 그대로, 프로젝트 제거는 -l", () => {
    expect(removeArgs("npm:pi-tools", "project")).toEqual(["remove", "npm:pi-tools", "-l"]);
    expect(removeArgs("git:github.com/x/y", "user")).toEqual(["remove", "git:github.com/x/y"]);
    expect(updateArgs("npm:pi-tools")).toEqual(["update", "npm:pi-tools"]);
  });
});

describe("npmNameOfSource·isPinned", () => {
  it("npm 소스에서 이름을 꺼내고, 버전이 붙었으면 고정으로 본다", () => {
    expect(npmNameOfSource("npm:pi-tools")).toBe("pi-tools");
    expect(npmNameOfSource("npm:pi-tools@1.2.3")).toBe("pi-tools");
    expect(npmNameOfSource("npm:@x/pi-tools@1.2.3")).toBe("@x/pi-tools");
    expect(npmNameOfSource("npm:@x/pi-tools")).toBe("@x/pi-tools");
    expect(npmNameOfSource("git:github.com/x/y")).toBeUndefined();
    expect(isPinned("npm:@x/pi-tools@1.2.3")).toBe(true);
    expect(isPinned("npm:@x/pi-tools")).toBe(false);
  });
});

describe("formatCount", () => {
  it("큰 수를 짧게", () => {
    expect(formatCount(1565803)).toBe("1.6M");
    expect(formatCount(12345)).toBe("12K");
    expect(formatCount(42)).toBe("42");
  });
});

describe("importName·scriptFiles", () => {
  it("이름을 Pi 규칙에 맞게 다듬는다", () => {
    expect(importName("Brave_Search")).toBe("brave-search");
    expect(importName("--a  b--")).toBe("a-b");
    expect(importName("x".repeat(70))).toHaveLength(64);
  });

  it("실행 스크립트만 고른다", () => {
    expect(scriptFiles([{ path: "SKILL.md" }, { path: "scripts/fill.py" }, { path: "run.sh" }, { path: "ref/a.txt" }])).toEqual([
      "scripts/fill.py",
      "run.sh",
    ]);
  });
});

describe("splitFrontmatter", () => {
  it("앞머리를 떼어 내고, 없으면 그대로", () => {
    expect(splitFrontmatter("---\nname: pdf\ndescription: x\n---\n# 본문\n")).toEqual({ meta: "name: pdf\ndescription: x", body: "# 본문\n" });
    expect(splitFrontmatter("# 본문")).toEqual({ body: "# 본문" });
  });
});

describe("excludeKindsFilter·packageFilterOf·filterForPlatform", () => {
  it("뺄 종류는 빈 배열로", () => {
    expect(excludeKindsFilter(["extensions", "themes"])).toEqual({ extensions: [], themes: [] });
    expect(excludeKindsFilter([])).toEqual({});
  });

  it("설정에서 그 소스의 필터만 꺼낸다", () => {
    const settings = { packages: ["npm:a", { source: "npm:b", skills: ["-skills/x/SKILL.md"], themes: [], autoload: false }] };
    expect(packageFilterOf(settings, "npm:b")).toEqual({ skills: ["-skills/x/SKILL.md"], themes: [] });
    expect(packageFilterOf(settings, "npm:a")).toBeUndefined();
    expect(packageFilterOf({}, "npm:a")).toBeUndefined();
  });

  it("+·- 경로만 대상 OS 구분자로 바꾸고 glob은 둔다", () => {
    const filter = { skills: ["-skills\\beta\\SKILL.md", "skills/*/SKILL.md"], prompts: ["+prompts/p.md"] };
    expect(filterForPlatform(filter, "linux")).toEqual({ skills: ["-skills/beta/SKILL.md", "skills/*/SKILL.md"], prompts: ["+prompts/p.md"] });
    expect(filterForPlatform(filter, "win32")).toEqual({ skills: ["-skills\\beta\\SKILL.md", "skills/*/SKILL.md"], prompts: ["+prompts\\p.md"] });
    expect(filterForPlatform(filter, undefined)).toEqual(filter);
  });
});

describe("commandSource", () => {
  it("로컬 경로 소스는 설치된 절대 경로로, npm·git·URL은 그대로 넘긴다", () => {
    expect(commandSource({ source: "..\\..\\pi-packages\\mine", installedPath: "C:\\Users\\me\\pi-packages\\mine" })).toBe("C:\\Users\\me\\pi-packages\\mine");
    expect(commandSource({ source: "./local", installedPath: "/home/me/proj/local" })).toBe("/home/me/proj/local");
    expect(commandSource({ source: "npm:pi-web-access", installedPath: "/x/node_modules/pi-web-access" })).toBe("npm:pi-web-access");
    expect(commandSource({ source: "git:github.com/a/b@v1", installedPath: "/x/git/b" })).toBe("git:github.com/a/b@v1");
    expect(commandSource({ source: "https://github.com/a/b" })).toBe("https://github.com/a/b");
    expect(commandSource({ source: "../not-installed" })).toBe("../not-installed");
  });
});