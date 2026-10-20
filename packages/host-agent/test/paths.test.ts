import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { socketPath } from "../src/paths";

describe("socketPath", () => {
  it("POSIX에서는 agentHome/run/agentd.sock", () => {
    expect(socketPath({ PI_DESKTOP_HOME: "/tmp/x" }, "linux")).toBe(join("/tmp/x", "run", "agentd.sock"));
  });

  it("Windows에서는 이름 있는 파이프를 쓰고, agentHome이 다르면 이름도 다르다", () => {
    const a = socketPath({ PI_DESKTOP_HOME: "C:\\a" }, "win32");
    const b = socketPath({ PI_DESKTOP_HOME: "C:\\b" }, "win32");
    expect(a.startsWith("\\\\.\\pipe\\pi-desktop-agentd-")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("Windows 경로 대소문자 차이는 같은 파이프로 본다", () => {
    expect(socketPath({ PI_DESKTOP_HOME: "C:\\Users\\A" }, "win32")).toBe(
      socketPath({ PI_DESKTOP_HOME: "c:\\users\\a" }, "win32"),
    );
  });
});
