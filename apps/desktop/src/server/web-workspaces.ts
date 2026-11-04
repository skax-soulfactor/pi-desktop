import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginWorkspaceId, WorkspacesState } from "../shared/api";

/**
 * 휴대폰 웹의 작업 공간 (설계 DESIGN-ONE-APP.md P4).
 * pi-web은 세 앱 서버를 함께 띄운다(`pi-web start`). 데이터 폴더는 $PI_WEB_HOME/data(Pi), agent, mate로 나란하다.
 * Pi Web 화면은 켜져 있는 Agent·Mate 서버의 주소(토큰 포함)를 받아 작업 공간 막대와 iframe으로 연다.
 * 켜고 끄기는 pi-web 명령이 한다 (`pi-web agent start`·`stop`).
 */
const PLUGINS: Array<{ id: PluginWorkspaceId; name: string; command: string }> = [
  { id: "agent", name: "Agent", command: "pi-web agent start" },
  { id: "mate", name: "Mate", command: "pi-web mate start" },
];

function alive(pidFile: string): boolean {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // 다른 사용자의 프로세스면 EPERM: 살아 있다
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** dataDir: Pi Web 서버의 데이터 폴더 ($PI_WEB_HOME/data) */
export function webWorkspacesState(dataDir: string): WorkspacesState {
  return {
    plugins: PLUGINS.map((p) => {
      const dir = join(dataDir, "..", p.id);
      const urlFile = join(dir, "url");
      // 서버가 뜨면 url을 쓰고(pi-web이 켤 때 지운다), pi-web이 pid를 적는다. pid 파일이 없으면(직접 띄움) url만 본다
      const pidFile = join(dir, "server.pid");
      const running = existsSync(urlFile) && (!existsSync(pidFile) || alive(pidFile));
      if (!running) return { id: p.id, name: p.name, enabled: false, reason: `꺼져 있습니다. 켜려면: ${p.command}` };
      const url = readFileSync(urlFile, "utf8").trim();
      return { id: p.id, name: p.name, enabled: true, url };
    }),
  };
}
