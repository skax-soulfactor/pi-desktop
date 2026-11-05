import { describe, expect, it } from "vitest";
import { piDesktopFromUninstall } from "../../src/main/pi-desktop-install";

describe("piDesktopFromUninstall", () => {
  const reg = [
    String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\198b06d1`,
    "    DisplayName    REG_SZ    Pi Desktop Mate 0.2.0",
    String.raw`    DisplayIcon    REG_SZ    C:\Users\me\AppData\Local\Programs\Pi Desktop Mate\Pi Desktop Mate.exe,0`,
    "",
    String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\9a907120`,
    "    DisplayName    REG_SZ    Pi Desktop 0.1.15",
    String.raw`    DisplayIcon    REG_SZ    D:\Apps\Pi Desktop\Pi Desktop.exe,0`,
    "",
    String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\fd2abd43`,
    "    DisplayName    REG_SZ    Pi Desktop Agent 0.1.0",
  ].join("\r\n");

  it("설치 정보에서 Pi Desktop(Mate·Agent 제외)의 실행 파일을 찾는다 (설치 폴더를 바꾼 경우)", () => {
    expect(piDesktopFromUninstall(reg)).toBe(String.raw`D:\Apps\Pi Desktop\Pi Desktop.exe`);
    expect(piDesktopFromUninstall(reg.replace("Pi Desktop 0.1.15", "Something 1.0"))).toBeUndefined();
    expect(piDesktopFromUninstall("")).toBeUndefined();
  });
});
