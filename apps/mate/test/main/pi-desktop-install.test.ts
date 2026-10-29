import { describe, expect, it } from "vitest";
import { pickPiDesktopAsset, type ReleaseAsset } from "../../src/main/pi-desktop-install";

const asset = (name: string): ReleaseAsset => ({ name, size: 1, browser_download_url: `https://x/${name}` });
const assets = [
  "Pi-Desktop-Setup-0.1.15.exe",
  "Pi-Desktop-Setup-0.1.15.exe.blockmap",
  "Pi-Desktop-0.1.15-arm64.dmg",
  "Pi-Desktop-0.1.15-x64.dmg",
  "Pi-Desktop-0.1.15-x86_64.AppImage",
  "Pi-Desktop-0.1.15-amd64.deb",
  "Pi-Desktop-Mate-Setup-0.1.0.exe",
  "Pi-Desktop-Mate-0.1.0-arm64.dmg",
  "latest.yml",
].map(asset);

describe("pickPiDesktopAsset", () => {
  it("OS·아키텍처에 맞는 Pi Desktop 설치 파일을 고르고, Mate 파일은 고르지 않는다", () => {
    expect(pickPiDesktopAsset(assets, "win32", "x64")?.name).toBe("Pi-Desktop-Setup-0.1.15.exe");
    expect(pickPiDesktopAsset(assets, "darwin", "arm64")?.name).toBe("Pi-Desktop-0.1.15-arm64.dmg");
    expect(pickPiDesktopAsset(assets, "darwin", "x64")?.name).toBe("Pi-Desktop-0.1.15-x64.dmg");
    expect(pickPiDesktopAsset(assets, "linux", "x64")?.name).toBe("Pi-Desktop-0.1.15-x86_64.AppImage");
    expect(pickPiDesktopAsset(assets.filter((a) => !a.name.startsWith("Pi-Desktop-0")), "darwin", "arm64")).toBeUndefined();
    expect(pickPiDesktopAsset([asset("Pi-Desktop-Mate-Setup-0.1.0.exe")], "win32", "x64")).toBeUndefined();
  });
});
