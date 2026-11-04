import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { Methods, type SessionEventNotification, type SessionSummary } from "@pi-desktop/host-protocol";
import { listenWebServer } from "@pi-desktop/web-shell/http-server";
import { isLoopbackAddress } from "@pi-desktop/web-shell/auth";
import { PushCenter } from "@pi-desktop/web-shell/push";
import { ShellChannels } from "@pi-desktop/web-shell/protocol";
import { IpcChannels, type UpdateState } from "../shared/api";
import { ActionLog } from "../main/action-log";
import { agentVersion } from "../main/agent-build";
import { initAppTunables } from "../main/app-tunables";
import { CopyStore } from "../main/copies";
import { HostManager } from "../main/host-manager";
import { ImportStore } from "../main/imports";
import { hostEventHandlers, registerHandlers } from "../main/ipc-handlers";
import { ReplayCollector } from "../main/replay-collector";
import { SshHostStore } from "../main/ssh-hosts";
import { TerminalService } from "../main/terminal";
import { WebRouter } from "./web-router";
import { webWorkspacesState } from "./web-workspaces";
import { sessionNote } from "./session-notify";
import { FileManager } from "./file-manager";
import { FILE_DOWNLOAD_PATH, FileChannels, sessionOpenValue } from "../shared/web-files";

/**
 * 웹 서버 pi-web (설계 §5.10). 데스크톱 앱의 main 프로세스 자리를 Node 서버가 맡고, 화면은 브라우저로 연다.
 * Android 휴대폰에서는 Termux에서 이 서버와 Pi를 돌리고 휴대폰 브라우저로 http://127.0.0.1:<포트>를 연다.
 *
 * 묶음(release) 구조: server.mjs 옆에 public/(화면), host-agent/host-agent.mjs, package.json
 * 주소·토큰 확인, 화면 파일, 공유 받기, 서비스 워커는 web-shell 서버(listenWebServer)가 맡는다.
 * WebSocket 메시지는 Agent·Mate(web-shell의 IpcHub)와 달리 데스크톱 main의 처리기(main/ipc-handlers)를 WebRouter로 바로 부른다.
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: flags } = parseArgs({
  options: {
    port: { type: "string" },
    host: { type: "string" },
    home: { type: "string" },
  },
});

const port = Number(flags.port ?? process.env.PI_WEB_PORT ?? 8787);
const listenHost = flags.host ?? process.env.PI_WEB_HOST ?? "127.0.0.1";
/** 데이터(토큰·SSH 호스트·작업 기록) 위치. 설치 스크립트는 ~/.pi-web/data를 쓴다 */
const dataDir = flags.home ?? process.env.PI_WEB_DATA ?? join(homedir(), ".pi-web", "data");
const publicDir = process.env.PI_WEB_PUBLIC ?? join(here, "public");
const agentScript = process.env.PI_DESKTOP_AGENT_SCRIPT ?? join(here, "host-agent", "host-agent.mjs");
const loopbackOnly = isLoopbackAddress(listenHost);

function appVersion(): string {
  try {
    return String(JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}
const version = appVersion();

const router = new WebRouter();
const replays = new ReplayCollector<SessionEventNotification>();
const sshHosts = new SshHostStore(join(dataDir, "ssh-hosts.json"));
const push = new PushCenter(dataDir);
const hosts: HostManager = new HostManager({
  agentScript,
  agentVersion: agentVersion(agentScript),
  sshHosts,
  ...hostEventHandlers((channel, ...payload) => {
    router.broadcast(channel, ...payload);
    if (channel === IpcChannels.sessionEvent) notifyInBackground(payload[0] as string, payload[1] as SessionEventNotification);
  }, replays),
});

/** 세션 id → 폴더 (알림 제목용). 모르는 세션이 오면 그 호스트의 목록을 다시 읽는다 */
const sessionFolders = new Map<string, string>();

/**
 * 휴대폰 알림 (설계 §5.10 "알림", web-shell의 웹 푸시). 보는 탭이 없을 때 작업이 끝나거나 답을 기다리면 웹 푸시로 보낸다.
 * 보는 탭이 있으면 화면이 이미 보여 준다.
 */
function notifyInBackground(hostId: string, n: SessionEventNotification): void {
  if (router.anyVisible() || push.count === 0 || !sessionNote(n.event, "")) return;
  void (async () => {
    if (!sessionFolders.has(n.sessionId)) {
      const sessions = await hosts.get(hostId).request<SessionSummary[]>(Methods.sessionList);
      for (const s of sessions) sessionFolders.set(s.sessionId, s.cwd);
    }
    const cwd = sessionFolders.get(n.sessionId) ?? "";
    const note = sessionNote(n.event, basename(cwd) || cwd || "세션");
    // 누르면 그 세션을 연다 (화면이 탭을 고르거나 새 탭으로 연다)
    if (note) await push.send({ title: `Pi Web · ${note.title}`, body: note.body, tag: n.sessionId, open: sessionOpenValue({ hostId, sessionId: n.sessionId }) });
  })().catch(() => undefined);
}
const terminals = new TerminalService({ data: IpcChannels.terminalData, exit: IpcChannels.terminalExit });

registerHandlers(router, {
  manager: hosts,
  sshHosts,
  imports: new ImportStore(join(dataDir, "imports.json")),
  copies: new CopyStore(join(dataDir, "copies.json")),
  actionLog: new ActionLog(join(dataDir, "activity-log.jsonl")),
  terminals,
  replays,
  // 브라우저는 서버의 OS 대화상자를 띄울 수 없다. 화면은 대신 폴더 탐색 창을 쓴다 (shell === "web")
  pickDirectory: async () => undefined,
  revealPath: () => false,
  appTunables: initAppTunables(dataDir),
});

// 앱 자동 업데이트는 데스크톱 앱 것이다. 웹 묶음은 `pi-web update`(설치 스크립트)로 바꾼다.
const noUpdates: UpdateState = { status: "disabled", current: version, mode: "notify" };
router.handle(IpcChannels.updateState, () => noUpdates);
router.handle(IpcChannels.checkForUpdates, () => noUpdates);
router.handle(IpcChannels.confirmUpdate, () => undefined);
router.handle(IpcChannels.installUpdate, () => undefined);
router.handle(IpcChannels.openRelease, () => undefined);
// 작업 공간 (DESIGN-ONE-APP.md P4): 함께 뜬 Agent·Mate 웹 서버를 작업 공간 막대에 띄운다. 켜고 끄기는 pi-web 명령이 한다
router.handle(IpcChannels.workspacesState, () => webWorkspacesState(dataDir));
router.handle(IpcChannels.setWorkspaceEnabled, () => {
  throw new Error("휴대폰 웹에서는 pi-web 명령으로 켜고 끕니다 (pi-web agent start, pi-web mate stop)");
});
router.handle(IpcChannels.workspaceShown, () => undefined);
router.handle(IpcChannels.workspaceReady, () => undefined);
router.handle(IpcChannels.revealWorkspace, () => undefined);

// 파일 관리자 (설계 §5.10): 서버(Termux)의 홈 폴더 아래를 화면에서 다룬다
const files = new FileManager();
router.handle(FileChannels.list, (_peer, path?: string) => files.list(path));
router.handle(FileChannels.makeDir, (_peer, parent: string, name: string) => files.makeDir(parent, name));
router.handle(FileChannels.makeFile, (_peer, parent: string, name: string) => files.makeFile(parent, name));
router.handle(FileChannels.rename, (_peer, path: string, name: string) => files.rename(path, name));
router.handle(FileChannels.transfer, (_peer, paths: string[], dest: string, mode: "move" | "copy") =>
  files.transfer(Array.isArray(paths) ? paths.map(String) : [], dest, mode === "copy" ? "copy" : "move"),
);
router.handle(FileChannels.remove, (_peer, paths: string[]) => files.remove(Array.isArray(paths) ? paths.map(String) : []));
router.handle(FileChannels.readText, (_peer, path: string) => files.readText(path));
router.handle(FileChannels.writeText, (_peer, path: string, text: string, baseMtime?: number) =>
  files.writeText(path, String(text), typeof baseMtime === "number" ? baseMtime : undefined),
);
router.handle(FileChannels.upload, (_peer, dir: string, name: string, base64: string) => files.upload(dir, String(name), String(base64)));
router.handle(FileChannels.downloadTicket, async (_peer, path: string) => ({ url: `${FILE_DOWNLOAD_PATH}?ticket=${await files.downloadTicket(path)}`}));

// 웹 푸시 구독 (화면은 web-shell의 notify.ts)
router.handle(ShellChannels.pushKey, () => push.publicKey());
router.handle(ShellChannels.pushSubscribe, (_peer, subscription: unknown) => {
  push.subscribe(subscription as Parameters<PushCenter["subscribe"]>[0]);
  return push.count;
});
router.handle(ShellChannels.pushUnsubscribe, (_peer, endpoint: string) => push.unsubscribe(String(endpoint)));
router.handle(ShellChannels.pushTest, async () => ({ sent: await push.send({ title: "Pi Web · 알림 시험", body: "휴대폰 알림이 잘 옵니다." }), total: push.count }));

const running = await listenWebServer({
  app: "Pi Desktop",
  version,
  port,
  host: listenHost,
  dataDir,
  publicDir,
  // 이미지 첨부(한 장 20MB, 열 장까지)가 base64로 한 메시지에 담길 수 있어 넉넉히 받는다.
  maxPayload: 300 * 1024 * 1024,
  route: (req, res) => {
    if (req.url?.split("?")[0] !== FILE_DOWNLOAD_PATH) return false;
    // 브라우저가 링크로 받으므로 토큰 대신 화면이 받은 일회용 티켓을 확인한다
    const ticket = new URL(req.url, "http://localhost").searchParams.get("ticket");
    void files.serveDownload(ticket, res).then((ok) => {
      if (!ok && !res.headersSent) res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("내려받기 주소가 지났거나 맞지 않습니다");
    });
    return true;
  },
  connect: (ws) => void router.attach(ws),
}).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

console.log(`Pi Web ${version}`);
console.log(`브라우저로 여세요: ${running.url}`);
if (!loopbackOnly) console.log(`주의: ${listenHost}에 열었습니다. 같은 네트워크의 다른 기기도 접속할 수 있으니 토큰을 남에게 보이지 마세요.`);

// 서버를 꺼도 각 호스트의 데몬과 Pi 세션은 계속 돈다. 연결기와 터미널만 정리한다 (설계 §3.4).
function shutdown(): void {
  terminals.dispose();
  hosts.dispose();
  running.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
