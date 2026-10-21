import { describe, expect, it } from "vitest";
import { childPath, emptyText, errorText, pathCrumbs, visibleDirs } from "../../src/renderer/folder-browser";

describe("childPath", () => {
  it("호스트 경로 형식에 맞는 구분자로 잇는다", () => {
    expect(childPath("/home/me", "src")).toBe("/home/me/src");
    expect(childPath("/", "home")).toBe("/home");
    expect(childPath("C:\\Users", "me")).toBe("C:\\Users\\me");
    expect(childPath("C:\\", "Users")).toBe("C:\\Users");
  });
});

describe("pathCrumbs", () => {
  it("POSIX 경로는 / 부터 마디마다", () => {
    expect(pathCrumbs("/home/me/src")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
      { label: "src", path: "/home/me/src" },
    ]);
    expect(pathCrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("Windows 경로는 드라이브부터", () => {
    expect(pathCrumbs("C:\\Users\\me")).toEqual([
      { label: "C:\\", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
    ]);
  });
});

describe("visibleDirs", () => {
  const dirs = [".cache", ".config", "Projects", "src", "my-project"];

  it("숨김 폴더는 켰을 때만", () => {
    expect(visibleDirs(dirs, "", false)).toEqual(["Projects", "src", "my-project"]);
    expect(visibleDirs(dirs, "", true)).toEqual(dirs);
  });

  it("거르기 글자가 이름에 들어 있는 것만, 대소문자 무시", () => {
    expect(visibleDirs(dirs, " proj ", false)).toEqual(["Projects", "my-project"]);
    expect(visibleDirs(dirs, "conf", true)).toEqual([".config"]);
  });
});

describe("errorText", () => {
  it("Electron IPC 접두사를 떼고 데몬의 문구만 남긴다", () => {
    expect(errorText(new Error("Error invoking remote method 'pi:list-dir': JsonRpcError: 폴더가 없습니다: /x"))).toBe("폴더가 없습니다: /x");
    expect(errorText(new Error("Error invoking remote method 'pi:list-dir': Error: 연결 끊김"))).toBe("연결 끊김");
    expect(errorText("그냥 문자열")).toBe("그냥 문자열");
  });
});

describe("emptyText", () => {
  it("거르는 중 · 숨김 폴더만 · 정말 없음을 구분한다", () => {
    expect(emptyText(["src"], "zz", false)).toBe("맞는 폴더가 없습니다");
    expect(emptyText([".cache"], "", false)).toBe("숨김 폴더만 있습니다");
    expect(emptyText([], "", true)).toBe("하위 폴더가 없습니다");
  });
});
