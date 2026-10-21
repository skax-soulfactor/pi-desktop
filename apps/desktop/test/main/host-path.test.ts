import { describe, expect, it } from "vitest";
import { hostPathForExplorer } from "../../src/main/host-path";

describe("hostPathForExplorer", () => {
  it("로컬은 작업 폴더 기준 Windows 경로", () => {
    expect(hostPathForExplorer("local", String.raw`C:\work\proj`, "src/a.ts", "wsl:")).toBe(String.raw`C:\work\proj\src\a.ts`);
    expect(hostPathForExplorer("local", String.raw`C:\work\proj`, String.raw`D:\x.txt`, "wsl:")).toBe(String.raw`D:\x.txt`);
  });

  it("WSL은 wsl.localhost 공유 경로", () => {
    expect(hostPathForExplorer("wsl:Ubuntu", "/home/me/proj", "src/a.ts", "wsl:")).toBe(
      String.raw`\\wsl.localhost\Ubuntu\home\me\proj\src\a.ts`,
    );
    expect(hostPathForExplorer("wsl:Ubuntu", "/home/me/proj", "/etc/hosts", "wsl:")).toBe(
      String.raw`\\wsl.localhost\Ubuntu\etc\hosts`,
    );
  });

  it("이 PC에서 열 수 없는 호스트는 undefined", () => {
    expect(hostPathForExplorer("ssh:box", "/home", "a", "wsl:")).toBeUndefined();
    expect(hostPathForExplorer("wsl:", "/home", "a", "wsl:")).toBeUndefined();
  });
});
