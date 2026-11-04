import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { clickMenu, clickNotification, hub, onBackgroundNotify } from "../electron/main";
import { CLICK_OPEN, ShellChannels, type DirEntry, type DirListing } from "../protocol";
import { listenWebServer } from "./http-server";
import { PushCenter } from "./push";
import { webDefault } from "../tunables-defs";

export { hub };
export { bearerToken, isLoopbackAddress, loadOrCreateToken, requestAllowed, tokenMatches } from "./auth";
export { listenWebServer, type HttpServerOptions, type RunningServer } from "./http-server";

export interface WebServerOptions {
  /** 화면에 보일 이름 (hello) */
  app: string;
  version: string;
  port: number;
  host: string;
  /** 토큰·주소 파일·올린 파일을 두는 곳 */
  dataDir: string;
  /** 화면 파일 (vite 결과) */
  publicDir: string;
}

/** 휴대폰에서 올린 파일 하나의 크기 한도 (base64 전) */
const MAX_UPLOAD_BYTES = webDefault("webShell.uploadMaxMb") * 1024 * 1024;

/**
 * 웹 껍데기의 서버 (설계 DESIGN.md §5.11): 화면 파일을 내주고, 토큰을 확인한 WebSocket을 IpcHub의 세션에 잇는다.
 * 앱 main 코드는 electron 대체 모듈(electron/main.ts)로 hub에 처리기를 건다.
 * 서버가 뜨면 토큰이 든 주소를 dataDir/url에 쓴다 (실행 명령이 읽어 보여 준다).
 */
export async function startWebServer(options: WebServerOptions): Promise<{ server: Server; url: string; close: () => void }> {
  registerShellHandlers(options.dataDir);
  const push = new PushCenter(options.dataDir);
  registerPush(push, options.app);

  const running = await listenWebServer({
    ...options,
    // 이미지·파일 올리기가 base64로 한 메시지에 담기므로 넉넉히 받는다
    maxPayload: 100 * 1024 * 1024,
    accept: (url) => {
      const last = Number(url.searchParams.get("last") ?? "0");
      return /^[\w-]{8,64}$/.test(url.searchParams.get("client") ?? "") && Number.isInteger(last) && last >= 0;
    },
    connect: (ws, url) => {
      // 끊긴 탭이 다시 붙으면 같은 세션을 이어 놓친 것을 받는다 (세션은 연결이 끊겨도 남는다)
      const clientId = url.searchParams.get("client") ?? "";
      const last = Number(url.searchParams.get("last") ?? "0");
      const { session, resumed } = hub.sessions.open(clientId, last);
      session.attach(ws, { t: "hello", resumed, app: options.app, version: options.version }, last);
      hub.attached(session, resumed);
    },
  });
  const sweeper = setInterval(() => hub.sessions.sweep(), 60_000);
  sweeper.unref();
  return {
    ...running,
    close: () => {
      clearInterval(sweeper);
      running.close();
    },
  };
}

/**
 * 웹 푸시: 브라우저가 알림을 허용하면 구독을 받아 두고, 보는 탭이 없을 때 앱의 알림(Notification)을 휴대폰 알림으로 보낸다.
 * 알림 제목 앞에 앱 이름을 붙인다 (Pi Web·Agent·Mate가 같은 휴대폰에서 알림을 보내므로).
 */
function registerPush(push: PushCenter, app: string): void {
  hub.override(ShellChannels.pushKey, () => push.publicKey());
  hub.override(ShellChannels.pushSubscribe, (_event, subscription: unknown) => {
    push.subscribe(subscription as Parameters<PushCenter["subscribe"]>[0]);
    return push.count;
  });
  hub.override(ShellChannels.pushUnsubscribe, (_event, endpoint: string) => push.unsubscribe(String(endpoint)));
  hub.override(ShellChannels.pushTest, async () => ({ sent: await push.send({ title: `${app} · 알림 시험`, body: "휴대폰 알림이 잘 옵니다." }), total: push.count }));
  onBackgroundNotify((note) => {
    void push
      .send({ title: note.title ? `${app} · ${note.title}` : app, ...(note.body ? { body: note.body } : {}), ...(note.clickId ? { open: `${CLICK_OPEN}${note.clickId}` } : {}) })
      .catch(() => 0);
  });
  hub.override(ShellChannels.notificationClick, (_event, id: string) => clickNotification(String(id)));
}

/** 웹 껍데기가 직접 처리하는 채널: 메뉴 누르기, 대화상자의 폴더 훑기, 휴대폰 파일 올리기 */
function registerShellHandlers(dataDir: string): void {
  hub.override(ShellChannels.menuClick, (_event, id: string) => clickMenu(String(id)));
  hub.override(ShellChannels.listDir, (_event, path?: string) => listDir(path));
  hub.override(ShellChannels.upload, async (_event, name: string, base64: string) => {
    const data = Buffer.from(String(base64), "base64");
    if (data.length > MAX_UPLOAD_BYTES) throw new Error(`${(data.length / 1024 / 1024).toFixed(1)}MB라 너무 큽니다 (50MB까지)`);
    const dir = join(dataDir, "uploads", new Date().toISOString().slice(0, 10));
    await mkdir(dir, { recursive: true });
    // 이름은 경로 조각을 빼고 쓴다. 같은 이름이 있으면 앞에 시각을 붙인다
    const safe = basename(String(name)).replace(/[\\/:*?"<>|\0]/g, "_") || "file";
    let target = join(dir, safe);
    if (await stat(target).catch(() => undefined)) target = join(dir, `${Date.now()}-${safe}`);
    await writeFile(target, data, { mode: 0o600 });
    return target;
  });
}

/** 서버의 폴더 내용 (숨긴 파일 포함, 폴더 먼저). 경로가 없으면 홈 */
export async function listDir(path?: string): Promise<DirListing> {
  const dir = resolve(path && path.trim() ? path.replace(/^~(?=$|\/)/, homedir()) : homedir());
  const names = await readdir(dir, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const entry of names) {
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) isDir = (await stat(join(dir, entry.name)).catch(() => undefined))?.isDirectory() ?? false;
    entries.push({ name: entry.name, path: join(dir, entry.name), dir: isDir });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const parent = dirname(dir);
  return { path: dir, ...(parent !== dir ? { parent } : {}), entries };
}
