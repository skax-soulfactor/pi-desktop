import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { app, appReady, configureShell, emitApp, hub, onQuit } from "@pi-desktop/web-shell/electron-main";
import { startWebServer } from "@pi-desktop/web-shell/server";
import { embeddedApp } from "@pi-desktop/web-shell/embed";
import { IpcChannels } from "../shared/api";

/**
 * Pi Desktop Agent 웹 버전의 서버 (설계 DESIGN.md §5.11). Agent의 main 코드(src/main)를 고치지 않고 Node에서 돌린다.
 * "electron"은 web-shell의 대체 모듈로 바뀌어 묶인다 (scripts/build-web.mjs).
 *
 * 묶음 구조: server.mjs 옆에 public/(화면), resources/(host-agent·agent-kit·pi-isolation: Agent 설치본의 extraResources와 같다)
 */

const here = dirname(fileURLToPath(import.meta.url));

/** Pi Web 서버가 한 프로세스로 불러왔으면 그 설정 (명령줄 인자는 Pi Web 것이라 읽지 않는다) */
const embedded = embeddedApp("agent");
const { values: flags } = embedded
  ? { values: {} as { port?: string; host?: string; home?: string } }
  : parseArgs({
  options: {
    port: { type: "string" },
    host: { type: "string" },
    home: { type: "string" },
  },
});

const port = embedded?.port ?? Number(flags.port ?? process.env.PI_WEB_PORT ?? 8788);
const host = embedded?.embed.host ?? flags.host ?? process.env.PI_WEB_HOST ?? "127.0.0.1";
/** 웹 서버의 데이터(토큰·호스트 선택·SSH 호스트·올린 파일). Agent의 앱 홈(~/.pi-desktop-agent)과는 다르다 */
const dataDir = embedded?.dataDir ?? flags.home ?? process.env.PI_WEB_DATA ?? join(homedir(), ".pi-web", "agent");
const publicDir = embedded ? join(here, "public") : (process.env.PI_WEB_PUBLIC ?? join(here, "public"));

function version(): string {
  try {
    return String(JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

configureShell({ name: "Pi Desktop Agent", version: version(), dataDir, appPath: here, packaged: true });
// 설치본처럼 번들 파일(host-agent, agent-kit, pi-isolation)을 resources에서 찾게 한다
if (embedded) {
  // 한 프로세스에서는 process.resourcesPath를 앱마다 바꿀 수 없다. 번들 파일 위치를 이 앱 이름의 환경 변수로 알린다
  const resources = join(here, "resources");
  // 창 아이콘처럼 위치만 읽는 곳을 위해 비어 있으면 채워 둔다 (번들 파일은 아래 환경 변수로 찾는다)
  const proc = process as unknown as { resourcesPath?: string };
  proc.resourcesPath ??= resources;
  process.env.PI_DESKTOP_AGENT_SCRIPT = join(resources, "host-agent", "host-agent.mjs");
  process.env.PI_DESKTOP_AGENT_KIT = join(resources, "agent-kit");
  process.env.PI_DESKTOP_PI_ISOLATION = join(resources, "pi-isolation");
} else {
  (process as unknown as { resourcesPath: string }).resourcesPath = process.env.PI_WEB_RESOURCES ?? join(here, "resources");
}

// Agent main: ipcMain 처리기를 걸고, app.whenReady 뒤에 데몬에 붙는다
await import("../main/web-main");

/**
 * Pi 관리·로그인은 Pi Desktop이 맡는다. 휴대폰에서는 같은 묶음의 Pi Web(pi-web, 8787)이 그 자리다.
 * "Pi Desktop 열기·설치"를 누르면 Pi Web 주소를 새 탭으로 연다.
 */
function piWebUrl(): string | undefined {
  try {
    return readFileSync(join(process.env.PI_WEB_HOME ?? join(homedir(), ".pi-web"), "data", "url"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function openPiWeb(): { status: string } {
  const url = piWebUrl();
  if (!url) throw new Error("Pi Web이 꺼져 있습니다. Termux에서 pi-web을 실행한 뒤 다시 누르세요");
  hub.controlOne({ kind: "open", url });
  return { status: "opened" };
}

appReady();
await app.whenReady();
hub.override(IpcChannels.openPiDesktop, () => Boolean(openPiWeb()));
hub.override(IpcChannels.installPiDesktop, () => openPiWeb());
// Pi 상태 안내에 "Pi Desktop 열기"가 보이도록, Pi Web이 켜져 있으면 그 주소를 Pi Desktop 자리에 둔다
const piSetup = hub.handler(IpcChannels.piSetup);
if (piSetup) {
  hub.override(IpcChannels.piSetup, async (event, ...args) => {
    const view = (await piSetup(event, ...args)) as Record<string, unknown>;
    return piWebUrl() ? { ...view, piDesktopPath: "Pi Web" } : view;
  });
}

const server = await startWebServer({ app: "Pi Desktop Agent", version: version(), port, host, dataDir, publicDir }).catch((error: Error) => {
  console.error(error.message);
  // 한 프로세스로 불려 왔으면 Pi Web은 그대로 두고 이 작업 공간만 빠진다
  if (embedded) throw error;
  process.exit(1);
});

console.log(`Pi Agent Web ${version()}`);
console.log(`브라우저로 여세요: ${server.url}`);

// 서버를 꺼도 데몬과 Pi 세션(예약 작업 포함)은 계속 돈다. 연결기만 정리한다 (Agent의 will-quit과 같다)
function shutdown(): void {
  emitApp("before-quit");
  emitApp("will-quit");
  server.close();
  if (!embedded) process.exit(0);
}
onQuit(shutdown);
if (embedded) {
  // 신호와 끄기는 Pi Web 서버가 받아 함께 끈다
  embedded.embed.urls.agent = server.url;
  embedded.embed.shutdowns.push(shutdown);
} else {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
