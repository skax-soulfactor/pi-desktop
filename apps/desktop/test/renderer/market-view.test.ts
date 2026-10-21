import { describe, expect, it } from "vitest";
import { formatCount, installArgs, isPinned, npmNameOfSource, removeArgs, updateArgs } from "../../src/renderer/market-view";

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
