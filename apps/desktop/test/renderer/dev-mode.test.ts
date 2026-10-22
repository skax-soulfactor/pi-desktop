import { describe, expect, it } from "vitest";
import { changedText, devModeRoots } from "../../src/renderer/dev-mode";

const ext = (path: string, fromPackage = false) => ({ name: "x", path, scope: "user", source: "auto", fromPackage, enabled: true });

describe("devModeRoots", () => {
  it("확장 파일·폴더와 extensions 폴더를 보되, 내장·패키지는 빼고 겹치는 것은 줄인다", () => {
    const roots = devModeRoots({
      cwd: "/home/me/proj",
      agentDir: "/home/me/.pi/agent",
      extensions: [
        ext("builtin:mcp"),
        ext("/home/me/.pi/agent/npm/node_modules/pkg/ext.ts", true),
        ext("/home/me/.pi/agent/extensions/solo.ts"),
        ext("/home/me/proj/.pi/extensions/tools/index.ts"),
        ext("/opt/dev/my-ext/index.js"),
        ext("/opt/dev/other.ts"),
      ],
    });
    expect(roots).toEqual(["/home/me/.pi/agent/extensions", "/home/me/proj/.pi/extensions", "/opt/dev/my-ext", "/opt/dev/other.ts"]);
  });

  it("Windows 경로는 \\로 잇는다", () => {
    expect(devModeRoots({ cwd: "C:\\p", agentDir: "C:\\Users\\me\\.pi\\agent", extensions: [] })).toEqual([
      "C:\\Users\\me\\.pi\\agent\\extensions",
      "C:\\p\\.pi\\extensions",
    ]);
  });
});

describe("changedText", () => {
  it("이름만 셋까지", () => {
    expect(changedText(["/a/b/index.ts"])).toBe("index.ts");
    expect(changedText(["a/1.ts", "a\\2.ts", "3.ts", "4.ts", "5.ts"])).toBe("1.ts, 2.ts, 3.ts 외 2개");
  });
});
