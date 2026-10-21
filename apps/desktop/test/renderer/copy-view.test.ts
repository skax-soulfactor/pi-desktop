import { describe, expect, it } from "vitest";
import {
  baseNameOf,
  copiedEntryPath,
  copyNote,
  copyWarnings,
  droppedText,
  extensionWarnings,
  isAlreadyExists,
  isLocalEndpoint,
  isLocalPathSource,
  joinHostPath,
  packageInstallArgs,
  textToBase64,
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

describe("isLocalEndpoint·droppedText", () => {
  it("대상 기준으로 해석되는 로컬 주소를 알아본다", () => {
    for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://0.0.0.0:8080", "http://[::1]:8000"]) {
      expect(isLocalEndpoint(url)).toBe(true);
    }
    expect(isLocalEndpoint("https://api.example.com/v1")).toBe(false);
    expect(isLocalEndpoint(undefined)).toBe(false);
    expect(isLocalEndpoint("not a url")).toBe(false);
  });

  it("뺀 비밀 필드를 알린다", () => {
    expect(droppedText([])).toBeUndefined();
    expect(droppedText(["apiKey", "headers.Authorization"])).toContain("API 키, 헤더 Authorization");
  });
});

describe("extensionWarnings", () => {
  const file = (path: string, text: string) => ({
    path,
    contentBase64: btoa(String.fromCharCode(...new TextEncoder().encode(text))),
  });

  it("대상 OS에서 돌지 않을 흔적을 파일별로 알린다", () => {
    const files = [
      file("index.ts", 'spawn("powershell", ["-Command", "ls"]);'),
      file("posix.ts", 'execSync("chmod +x run.sh"); spawn("/usr/bin/env", ["node"]);'),
      file("README.md", "powershell 설명"),
    ];
    expect(extensionWarnings(files, "linux")).toEqual([expect.stringContaining("index.ts에 PowerShell")]);
    const win = extensionWarnings(files, "win32");
    expect(win).toHaveLength(1);
    expect(win[0]).toContain("posix.ts에 유닉스 경로(/usr/ 등), chmod·xdg-open");
  });

  it("OS를 모르면 경고하지 않고, OS별 분기가 있으면 덧붙인다", () => {
    const files = [file("a.js", 'const sh = process.platform === "win32" ? "cmd.exe" : "/bin/sh"; spawn(sh, ["/c", "x"]); const p = "C:\\\\tools";')];
    expect(extensionWarnings(files, undefined)).toEqual([]);
    expect(extensionWarnings(files, "linux")[0]).toContain("드라이브 경로(C:\\)");
    expect(extensionWarnings(files, "linux")[0]).toContain("나눠 쓰는 코드");
    expect(extensionWarnings([file("한글.ts", "// 한글만")], "linux")).toEqual([]);
  });
});

describe("copiedEntryPath·copyNote·textToBase64", () => {
  it("대상에서 목록에 보일 진입 파일 경로를 만든다", () => {
    expect(copiedEntryPath("skill", "/home/me/.pi/agent/skills/pdf", "C:/x/SKILL.md", 2)).toBe("/home/me/.pi/agent/skills/pdf/SKILL.md");
    expect(copiedEntryPath("prompt", "/a/prompts/r.md", "/b/r.md", 1)).toBe("/a/prompts/r.md");
    expect(copiedEntryPath("extension", "/a/extensions/x.ts", "/b/solo.ts", 1)).toBe("/a/extensions/x.ts");
    expect(copiedEntryPath("extension", "C:\\a\\extensions\\t", "/b/t/index.js", 3)).toBe("C:\\a\\extensions\\t\\index.js");
  });

  it("출처와 바뀐 것을 짧게 알리고, 한글도 base64로 바꾼다", () => {
    expect(copyNote(undefined, "WSL: Ubuntu")).toBe("WSL: Ubuntu에서 복사됨");
    expect(copyNote({ local: "modified", source: "changed" }, "로컬")).toBe("로컬에서 복사됨 · 이 호스트에서 고침 · 이후 원본이 바뀜");
    expect(copyNote({ local: "same", source: "gone" }, "로컬")).toBe("로컬에서 복사됨 · 원본이 없어짐");
    expect(atob(textToBase64("ab"))).toBe("ab");
    expect(textToBase64("한")).toBe("7ZWc");
  });
});
