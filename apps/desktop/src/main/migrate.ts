import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SshHostConfig } from "../shared/api";

/**
 * 0.7.0 합치기: 옛 단독 Agent·Mate 앱의 작은 설정 파일을 Pi Desktop으로 옮긴다 (설계 DESIGN-ONE-APP.md §9).
 * 데이터 홈(~/.pi-desktop-agent, ~/.pi-desktop-mate)은 그대로라 옮길 것은 각 앱 userData의 파일뿐이다.
 * - agent-host.json·mate-host.json(지금 호스트), app-tunables.json(앱 수치) → userData/agent/·mate/ (그 작업 공간이 읽는 곳)
 * - ssh-hosts.json → Pi Desktop 목록에 이름이 없는 항목만 더한다
 * 처음 한 번만 하고 migrated-from.json에 적는다. 옛 앱 폴더의 파일은 지우지 않는다. 이미 있는 파일은 덮어쓰지 않는다.
 */
export const MIGRATED_FILE = "migrated-from.json";

export interface OldApp {
  id: "agent" | "mate";
  /** 옛 앱의 userData (appData/<productName>) */
  dir: string;
  /** 옮길 파일 (userData/<id>/로) */
  files: string[];
}

export function oldApps(appData: string): OldApp[] {
  return [
    { id: "agent", dir: join(appData, "Pi Desktop Agent"), files: ["agent-host.json", "app-tunables.json"] },
    { id: "mate", dir: join(appData, "Pi Desktop Mate"), files: ["mate-host.json", "app-tunables.json"] },
  ];
}

export interface MigrateResult {
  /** 이번에 옮겼는가 (이미 옮겼으면 false) */
  ran: boolean;
  copied: string[];
  sshHostsAdded: string[];
}

export function migrateFromOldApps(options: {
  userData: string;
  apps: OldApp[];
  sshHosts: { list(): SshHostConfig[]; save(host: SshHostConfig): unknown };
}): MigrateResult {
  const marker = join(options.userData, MIGRATED_FILE);
  if (existsSync(marker)) return { ran: false, copied: [], sshHostsAdded: [] };
  const copied: string[] = [];
  const sshHostsAdded: string[] = [];
  const from: string[] = [];
  for (const old of options.apps) {
    if (!existsSync(old.dir)) continue;
    from.push(old.dir);
    const target = join(options.userData, old.id);
    for (const name of old.files) {
      const source = join(old.dir, name);
      const dest = join(target, name);
      if (!existsSync(source) || existsSync(dest)) continue;
      try {
        mkdirSync(target, { recursive: true });
        copyFileSync(source, dest);
        copied.push(`${old.id}/${name}`);
      } catch {
        // 못 옮긴 파일은 기본값으로 시작한다
      }
    }
    for (const host of readSshHosts(join(old.dir, "ssh-hosts.json"))) {
      if (options.sshHosts.list().some((h) => h.name === host.name)) continue;
      try {
        options.sshHosts.save(host);
        sshHostsAdded.push(host.name);
      } catch {
        // 형식이 맞지 않는 항목은 건너뛴다
      }
    }
  }
  try {
    mkdirSync(options.userData, { recursive: true });
    writeFileSync(marker, `${JSON.stringify({ at: new Date().toISOString(), from, copied, sshHostsAdded }, null, 2)}\n`, "utf8");
  } catch {
    // 적지 못하면 다음 실행에 다시 본다 (덮어쓰지 않으므로 해가 없다)
  }
  return { ran: true, copied, sshHostsAdded };
}

function readSshHosts(file: string): SshHostConfig[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { hosts?: unknown };
    if (!Array.isArray(parsed.hosts)) return [];
    return parsed.hosts.filter(
      (h): h is SshHostConfig => !!h && typeof (h as SshHostConfig).name === "string" && typeof (h as SshHostConfig).target === "string",
    );
  } catch {
    return [];
  }
}
