import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATED_FILE, migrateFromOldApps, oldApps } from "../../src/main/migrate";
import { SshHostStore } from "../../src/main/ssh-hosts";

describe("옛 Agent·Mate 설정 옮기기 (0.7.0)", () => {
  it("지금 호스트·앱 수치를 작업 공간 폴더로, SSH 호스트는 없는 이름만 더하고 한 번만 한다", () => {
    const appData = mkdtempSync(join(tmpdir(), "migrate-"));
    const userData = join(appData, "Pi Desktop");
    const agent = join(appData, "Pi Desktop Agent");
    const mate = join(appData, "Pi Desktop Mate");
    for (const dir of [userData, agent, mate]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(agent, "agent-host.json"), '{"hostId":"wsl:Ubuntu"}');
    writeFileSync(join(agent, "app-tunables.json"), '{"app.x":1}');
    writeFileSync(join(agent, "ssh-hosts.json"), JSON.stringify({ hosts: [{ name: "box", target: "me@box" }, { name: "dev", target: "me@dev" }] }));
    writeFileSync(join(mate, "mate-host.json"), '{"hostId":"local"}');
    writeFileSync(join(mate, "ssh-hosts.json"), JSON.stringify({ hosts: [{ name: "box", target: "other@box" }] }));
    // Mate 작업 공간 미리 보기를 써서 이미 있는 파일은 덮어쓰지 않는다
    mkdirSync(join(userData, "mate"));
    writeFileSync(join(userData, "mate", "mate-host.json"), '{"hostId":"ssh:dev"}');
    const ssh = new SshHostStore(join(userData, "ssh-hosts.json"));
    ssh.save({ name: "dev", target: "me@dev2" });

    const result = migrateFromOldApps({ userData, apps: oldApps(appData), sshHosts: ssh });
    expect(result.ran).toBe(true);
    expect(result.copied.sort()).toEqual(["agent/agent-host.json", "agent/app-tunables.json"]);
    expect(result.sshHostsAdded).toEqual(["box"]);
    expect(readFileSync(join(userData, "agent", "agent-host.json"), "utf8")).toContain("wsl:Ubuntu");
    expect(readFileSync(join(userData, "mate", "mate-host.json"), "utf8")).toContain("ssh:dev");
    expect(ssh.list().map((h) => `${h.name}=${h.target}`)).toEqual(["dev=me@dev2", "box=me@box"]);
    expect(existsSync(join(userData, MIGRATED_FILE))).toBe(true);
    // 옛 파일은 남는다
    expect(existsSync(join(agent, "agent-host.json"))).toBe(true);

    expect(migrateFromOldApps({ userData, apps: oldApps(appData), sshHosts: ssh }).ran).toBe(false);
  });

  it("옛 앱이 없으면 아무것도 옮기지 않고 표시만 남긴다", () => {
    const appData = mkdtempSync(join(tmpdir(), "migrate-"));
    const userData = join(appData, "Pi Desktop");
    const ssh = new SshHostStore(join(userData, "ssh-hosts.json"));
    const result = migrateFromOldApps({ userData, apps: oldApps(appData), sshHosts: ssh });
    expect(result).toEqual({ ran: true, copied: [], sshHostsAdded: [] });
  });
});
