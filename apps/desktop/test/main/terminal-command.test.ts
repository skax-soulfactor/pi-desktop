import { describe, expect, it } from "vitest";
import { terminalCommand, type PiRuntime } from "../../src/main/terminal-command";

const localRuntime: PiRuntime = {
  pi: { cliPath: "C:\\pi\\cli.js", packageDir: "C:\\pi", version: "1.3.0", source: "npm-global" },
  nodePath: "C:\\node\\node.exe",
};
const wslRuntime: PiRuntime = {
  pi: {
    cliPath: "/home/me/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    packageDir: "/x",
    version: "1.3.0",
    source: "managed",
    env: { PI_MANAGED_INSTALL_ROOT: "/home/me/.pi/agent/install" },
  },
  nodePath: "/usr/bin/node",
};

describe("terminalCommand", () => {
  it("로컬 pi: 찾은 node와 cli.js로 직접, 인자·작업 폴더·환경 변수를 넘긴다", () => {
    expect(terminalCommand({ hostId: "local", kind: "pi", cwd: "C:\\work", args: ["--session", "s.jsonl"] }, localRuntime)).toEqual({
      file: "C:\\node\\node.exe",
      args: ["C:\\pi\\cli.js", "--session", "s.jsonl"],
      env: {},
      cwd: "C:\\work",
      title: "pi",
    });
  });

  it("로컬 셸은 PowerShell", () => {
    expect(terminalCommand({ hostId: "local", kind: "shell" }, undefined)).toMatchObject({ file: "powershell.exe", args: ["-NoLogo"] });
  });

  it("WSL pi: wsl.exe가 배포판 안에서 env로 관리형 설치 변수를 넘겨 실행한다", () => {
    expect(terminalCommand({ hostId: "wsl:Ubuntu", kind: "pi" }, wslRuntime)).toEqual({
      file: "wsl.exe",
      args: [
        "-d",
        "Ubuntu",
        "--cd",
        "~",
        "--exec",
        "env",
        "PI_MANAGED_INSTALL_ROOT=/home/me/.pi/agent/install",
        "/usr/bin/node",
        wslRuntime.pi.cliPath,
      ],
      env: {},
      title: "pi (WSL: Ubuntu)",
    });
  });

  it("WSL 셸은 그 폴더에서 기본 셸", () => {
    expect(terminalCommand({ hostId: "wsl:Ubuntu", kind: "shell", cwd: "/home/me/proj" }, undefined).args).toEqual([
      "-d",
      "Ubuntu",
      "--cd",
      "/home/me/proj",
    ]);
  });

  it("Pi를 못 찾았거나 모르는 호스트면 오류", () => {
    expect(() => terminalCommand({ hostId: "local", kind: "pi" }, undefined)).toThrow("Pi를 찾지 못했습니다");
    expect(() => terminalCommand({ hostId: "docker:box", kind: "shell" }, undefined)).toThrow("아직 지원하지 않습니다");
  });
});
