import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendChat, readChat, readInbox } from "@pi-desktop/mate-kit";
import { listSkillsIn, saveSkill } from "@pi-desktop/agent-kit/skills";
import { readMcpFile, serverViews, updateMcpFile, withEnabled, withoutServer, withPreset } from "@pi-desktop/pi-isolation/mcp-file";
import { WEB_SEARCH_PRESETS as MCP_PRESETS } from "@pi-desktop/pi-isolation/mcp-presets";
import {
  addChatRequest,
  addRequest,
  loadChatState,
  delegateInboxItem,
  applyInboxChange,
  applyInstall,
  describeInstall,
  discardInboxChange,
  execCommand,
  OBSERVER_DUTY_ID,
  OBSERVER_NAME,
  readActivity,
  topicFeedback,
  clearChat,
  deleteDuty,
  deleteRun,
  deleteSkill as deleteMateSkill,
  dutyIdFrom,
  emptyTrash,
  listTrash,
  restoreTrash,
  findSessionFile,
  getDuty,
  isAlive,
  isDutyId,
  listDuties,
  listRuns,
  loadConfig,
  loadInboxState,
  loadState,
  mateHome,
  matePaths,
  nextRunAt,
  pendingRequests,
  readPid,
  saveConfig,
  saveDuty,
  setInboxStatus,
  type ConfigPatch,
  type InboxStatus,
} from "@pi-desktop/mate-runner";
import { IpcChannels, type DutyDraft, type McpCheckResult, type Overview, type PiReadiness, type PiSetupView, type RunnerView, type SkillInput } from "../shared/api";
import { getAutostart, isRunnerOnlyLaunch, RUNNER_ONLY_ARG, setAutostart } from "./autostart";
import { installPiDesktop, openPiDesktop, piDesktopInfo } from "./pi-setup";
import { runnerCommand } from "./runner-process";
import {
  createPairingCode,
  removeTelegram,
  saveTelegramToken,
  sendTelegramTest,
  telegramEnv,
  telegramView,
  unpairTelegram,
} from "./telegram-setup";
import { Updater } from "./updater";
import { parseTranscript } from "./session-transcript";

const here = fileURLToPath(new URL(".", import.meta.url));
const paths = matePaths(mateHome());

/** 번들된 실행기. 설치본은 앱 리소스(M3), 개발 중에는 워크스페이스의 빌드 결과 */
function runnerScript(): string {
  if (process.env.PI_DESKTOP_MATE_RUNNER) return process.env.PI_DESKTOP_MATE_RUNNER;
  if (app.isPackaged) return join(process.resourcesPath, "mate-runner", "mate-runner.mjs");
  return resolve(app.getAppPath(), "../../packages/mate-runner/dist/mate-runner.mjs");
}

/** mate-kit 폴더. 실행기가 띄우는 Pi가 이 경로의 확장을 -e로 불러온다 */
function kitDir(): string {
  if (process.env.PI_DESKTOP_MATE_KIT) return process.env.PI_DESKTOP_MATE_KIT;
  if (app.isPackaged) return join(process.resourcesPath, "mate-kit");
  return resolve(app.getAppPath(), "../../packages/mate-kit");
}

function runnerEnv(): Record<string, string> {
  return { MATE_HOME: paths.home, PI_DESKTOP_MATE_KIT: kitDir() };
}

// 개발 실행은 설치본과 userData(창 상태·단일 인스턴스 잠금)를 나눈다.
// 같으면 설치본이 켜져 있을 때 개발 실행이 잠금에 걸려 바로 끝나고, 설치본 창을 앞으로 불러낸다.
if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "Pi Desktop Mate (dev)"));

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let runnerError: string | undefined;

/** 실행기를 멈췄다가 다시 띄운다 (토큰이 바뀌어 환경 변수를 다시 넘겨야 할 때) */
async function restartRunner(): Promise<void> {
  await runnerCommand(runnerScript(), "stop", runnerEnv()).catch(() => undefined);
  await ensureRunner();
}

async function ensureRunner(): Promise<void> {
  try {
    // 휴대폰 연결 토큰은 실행기를 띄울 때만 풀어서 넘긴다
    const result = await runnerCommand(runnerScript(), "start", { ...runnerEnv(), ...(await telegramEnv(paths)) });
    runnerError = result.status === "failed" ? "실행기를 띄우지 못했습니다. 로그를 확인하세요." : undefined;
  } catch (error) {
    runnerError = `실행기를 띄우지 못했습니다: ${(error as Error).message}`;
  }
}

/** Pi 준비 상태. pi --list-models가 몇 초 걸려 5분 동안 기억해 둔다 */
let readinessCache: Promise<PiSetupView> | undefined;
let readinessAt = 0;

function readiness(refresh = false): Promise<PiSetupView> {
  if (refresh || !readinessCache || Date.now() - readinessAt > 5 * 60_000) {
    readinessAt = Date.now();
    readinessCache = runnerCommand(runnerScript(), "status", runnerEnv()).then(
      async (status) => ({ ...(status as unknown as PiReadiness), ...(await piDesktopInfoView()), checkedAt: Date.now() }),
      async (error: Error) => ({
        stage: "no-pi" as const,
        piError: `Pi 상태를 확인하지 못했습니다: ${error.message}`,
        node: { path: "", ok: false },
        authProviders: [],
        models: [],
        ...(await piDesktopInfoView()),
        checkedAt: Date.now(),
      }),
    );
  }
  return readinessCache;
}

async function piDesktopInfoView(): Promise<{ piDesktopPath?: string }> {
  const info = await piDesktopInfo();
  return info.installedPath ? { piDesktopPath: info.installedPath } : {};
}

async function runnerView(): Promise<RunnerView> {
  const [pid, state] = await Promise.all([readPid(paths), loadState(paths)]);
  const alive = isAlive(pid);
  return {
    alive,
    ...(alive && pid ? { pid } : {}),
    ...(state.heartbeatAt ? { heartbeatAt: state.heartbeatAt } : {}),
    ...(alive && state.current ? { current: state.current } : {}),
    today: state.today,
    ...(runnerError && !alive ? { error: runnerError } : {}),
  };
}

async function overview(): Promise<Overview> {
  const [config, duties, state, requests, items, inboxState, runs, runner] = await Promise.all([
    loadConfig(paths),
    listDuties(paths),
    loadState(paths),
    pendingRequests(paths),
    readInbox(paths.inbox),
    loadInboxState(paths),
    listRuns(paths, 100),
    runnerView(),
  ]);
  const trash = await listTrash(paths);
  const [activity, feedback, chatLines, chatState] = await Promise.all([readActivity(paths, 150), topicFeedback(paths), readChat(paths.chat), loadChatState(paths)]);
  const now = Date.now();
  const names = new Map<string, string>([[OBSERVER_DUTY_ID, OBSERVER_NAME], ...duties.map((d) => [d.id, d.name] as [string, string])]);
  const queued = new Set(requests.map((r) => r.dutyId));
  return {
    home: paths.home,
    chat: {
      lines: chatLines.slice(-300),
      ...(chatState.busy ? { busy: chatState.busy } : {}),
      pending: Object.keys(chatState.pending).length,
    },
    config,
    duties: duties.map((duty) => {
      const last = state.duties[duty.id];
      const next = nextRunAt(duty, last?.lastRunAt, now, last?.watch);
      const pending = last?.watch?.pending;
      return {
        ...duty,
        ...(last?.lastRunAt ? { lastRunAt: last.lastRunAt } : {}),
        ...(last?.lastStatus ? { lastStatus: last.lastStatus } : {}),
        ...(next !== undefined ? { nextRunAt: next } : {}),
        ...(pending ? { pendingChange: { cause: pending.cause, since: pending.since } } : {}),
        queued: queued.has(duty.id),
      };
    }),
    inbox: items
      .map((item) => ({ ...item, ...(inboxState[item.id] ? { status: inboxState[item.id]!.status } : {}), dutyName: names.get(item.dutyId) ?? item.dutyId }))
      .sort((a, b) => b.createdAt - a.createdAt),
    runs,
    runner,
    observe: {
      activity: activity.reverse(),
      queue: state.observer?.queue.length ?? 0,
      today: state.observer?.today ?? { date: "", count: 0 },
      projects: Object.values(state.observer?.projects ?? {}),
      feedback,
      ...(state.observer ? { since: state.observer.since } : {}),
    },
    trash,
  };
}

/**
 * "Mate에게 맡기기": 제안의 맡길 일을 그 폴더에서 바로 실행한다 (설계 DESIGN-MATE.md §10).
 * git 저장소면 고치기(act: 별도 작업 공간, 적용은 사용자가), 아니면 제안 단계로. 임무로 남겨 다시 돌릴 수 있게 한다.
 */
async function delegate(itemId: string): Promise<void> {
  await delegateInboxItem(paths, itemId);
  if (!isAlive(await readPid(paths))) await ensureRunner();
}

/** 사용자의 말을 대화 기록에 남기고 실행기에 넘긴다 (답은 실행기가 남김) */
async function chatSend(text: string, answerTo?: string): Promise<void> {
  const t = text.trim().slice(0, 4000);
  if (!t) return;
  const line = await appendChat(paths.chat, { role: "user", text: t, source: "app", ...(answerTo ? { answerTo } : {}) });
  await addChatRequest(paths, { text: t, source: "app", lineId: line.id, ...(answerTo ? { answerTo } : {}) });
  if (!isAlive(await readPid(paths))) await ensureRunner();
}

async function saveDraft(draft: DutyDraft) {
  const now = Date.now();
  if (draft.id) {
    const existing = await getDuty(paths, draft.id);
    if (!existing) throw new Error("임무를 찾지 못했습니다");
    return saveDuty(paths, { ...existing, ...draft, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
  }
  const id = dutyIdFrom(draft.name, (await listDuties(paths)).map((d) => d.id));
  return saveDuty(paths, { ...draft, id, createdAt: now });
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.overview, () => overview());
  ipcMain.handle(IpcChannels.saveDuty, (_e, draft: DutyDraft) => saveDraft(draft));
  ipcMain.handle(IpcChannels.deleteDuty, (_e, id: string) => deleteDuty(paths, id));
  // 휴지통 (설계 DESIGN-APPS.md §3.2): 지운 것은 Mate 홈의 trash/에 두었다가 되살리거나 비운다
  ipcMain.handle(IpcChannels.deleteRun, (_e, id: string) => deleteRun(paths, id));
  ipcMain.handle(IpcChannels.clearChat, () => clearChat(paths));
  ipcMain.handle(IpcChannels.restoreTrash, async (_e, id: string) => {
    await restoreTrash(paths, id);
  });
  ipcMain.handle(IpcChannels.emptyTrash, (_e, ids?: string[]) => emptyTrash(paths, ids));
  // Mate가 제안한 설치: 적용은 실행기와 같은 코드로 한다 (DESIGN-APPS.md §3.4)
  ipcMain.handle(IpcChannels.applyInstall, (_e, itemId: string) => applyInstall(paths, itemId));
  ipcMain.handle(IpcChannels.describeInstall, async (_e, itemId: string) => {
    const item = (await readInbox(paths.inbox)).find((i) => i.id === itemId);
    if (!item?.install) throw new Error("설치 제안을 찾지 못했습니다");
    return describeInstall(item.install);
  });
  // 스킬·MCP (설계 DESIGN-APPS.md §3.4): Mate 홈의 skills/·mcp.json을 Agent와 같은 형식·코드로 다룬다
  ipcMain.handle(IpcChannels.skillsList, () => listSkillsIn(paths.skills));
  ipcMain.handle(IpcChannels.skillSave, async (_e, previous: string | undefined, input: SkillInput) => {
    await saveSkill(paths.skills, input, previous);
  });
  ipcMain.handle(IpcChannels.skillDelete, (_e, name: string) => deleteMateSkill(paths, name));
  ipcMain.handle(IpcChannels.skillOpenFolder, async () => {
    await mkdir(paths.skills, { recursive: true });
    const error = await shell.openPath(paths.skills);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IpcChannels.listMcp, async () => serverViews(await readMcpFile(paths.mcp)));
  ipcMain.handle(IpcChannels.addMcpPreset, (_e, id: string, key?: string) => {
    const preset = MCP_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`목록에 없는 서버입니다: ${id}`);
    return updateMcpFile(paths.mcp, (file) => withPreset(file, preset, key));
  });
  ipcMain.handle(IpcChannels.setMcpEnabled, (_e, name: string, enabled: boolean) => updateMcpFile(paths.mcp, (file) => withEnabled(file, name, enabled === true)));
  ipcMain.handle(IpcChannels.removeMcp, (_e, name: string) => updateMcpFile(paths.mcp, (file) => withoutServer(file, name)));
  ipcMain.handle(IpcChannels.openMcpFile, async () => {
    await updateMcpFile(paths.mcp, (file) => ({ mcpServers: {}, ...file }));
    const error = await shell.openPath(paths.mcp);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IpcChannels.checkMcp, async () => (await runnerCommand(runnerScript(), "mcp-check", runnerEnv())) as unknown as McpCheckResult);
  ipcMain.handle(IpcChannels.runNow, async (_e, id: string) => {
    if (!isDutyId(id)) throw new Error("잘못된 임무 id입니다");
    await addRequest(paths, id);
    // 실행기가 꺼져 있으면 다시 띄운다 (요청 파일은 실행기가 뜨면 처리)
    if (!isAlive(await readPid(paths))) await ensureRunner();
  });
  ipcMain.handle(IpcChannels.setInbox, async (_e, ids: string[], status: InboxStatus | undefined) => {
    await setInboxStatus(paths, ids.filter((id) => typeof id === "string"), status);
  });
  ipcMain.handle(IpcChannels.saveConfig, (_e, patch: ConfigPatch) => saveConfig(paths, patch));
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.restartRunner, async () => {
    await restartRunner();
    return runnerView();
  });
  ipcMain.handle(IpcChannels.revealHome, () => shell.openPath(paths.home));
  ipcMain.handle(IpcChannels.getAutostart, () => getAutostart());
  ipcMain.handle(IpcChannels.telegramView, () => telegramView(paths));
  ipcMain.handle(IpcChannels.telegramSetToken, async (_e, token: string) => {
    await saveTelegramToken(paths, String(token));
    await restartRunner();
    return telegramView(paths);
  });
  ipcMain.handle(IpcChannels.telegramRemove, async () => {
    await removeTelegram(paths);
    await restartRunner();
    return telegramView(paths);
  });
  ipcMain.handle(IpcChannels.telegramPair, async () => {
    await createPairingCode(paths);
    return telegramView(paths);
  });
  ipcMain.handle(IpcChannels.telegramUnpair, async () => {
    await unpairTelegram(paths);
    return telegramView(paths);
  });
  ipcMain.handle(IpcChannels.telegramTest, () => sendTelegramTest(paths));
  ipcMain.handle(IpcChannels.chatSend, (_e, text: string, answerTo?: string) =>
    chatSend(String(text ?? ""), typeof answerTo === "string" ? answerTo : undefined),
  );
  ipcMain.handle(IpcChannels.piReadiness, (_e, refresh: boolean) => readiness(refresh === true));
  ipcMain.handle(IpcChannels.installPiDesktop, () =>
    installPiDesktop(mainWindow, (received, total) => mainWindow?.webContents.send(IpcChannels.installProgress, received, total)),
  );
  ipcMain.handle(IpcChannels.openPiDesktop, () => openPiDesktop());
  ipcMain.handle(IpcChannels.setAutostart, (_e, enabled: boolean) => setAutostart(enabled === true));
  ipcMain.handle(IpcChannels.delegate, (_e, itemId: string) => delegate(String(itemId)));
  ipcMain.handle(IpcChannels.applyChange, (_e, itemId: string) => applyInboxChange(paths, String(itemId)));
  ipcMain.handle(IpcChannels.discardChange, (_e, itemId: string) => discardInboxChange(paths, String(itemId)));
  ipcMain.handle(IpcChannels.readSession, async (_e, runId: string) => {
    const run = (await listRuns(paths, 1000)).find((r) => r.id === runId);
    // 실행 기록에 적힌 경로라도 Mate 홈의 sessions/ 밖은 읽지 않는다
    const file = run?.sessionId ? await findSessionFile(paths, run.sessionId) : undefined;
    if (!file) throw new Error("이 실행의 세션 파일을 찾지 못했습니다");
    return parseTranscript(await readFile(file, "utf8"));
  });
}

/** Mate 홈의 파일이 바뀌면 화면에 알린다 (실행기·확장이 쓰는 파일 포함). 잦은 변경은 묶는다 */
function watchHome(): FSWatcher | undefined {
  let timer: NodeJS.Timeout | undefined;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannels.changed);
    }, 200);
  };
  try {
    return watch(paths.home, { recursive: true }, (_event, name) => {
      // Pi 세션 파일·로그(대화 세션·할 일 포함)는 실행 중 계속 바뀌므로 화면 갱신에서 뺀다
      if (name && /^(sessions|run|chat[\\/](sessions|actions))[\\/]/.test(name)) return;
      notify();
    });
  } catch {
    return undefined;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: "Pi Desktop Mate",
    // Linux 설치본은 실행 파일에 아이콘이 없어 창에 직접 준다 (electron-builder.yml extraResources)
    ...(process.platform === "linux" && app.isPackaged ? { icon: join(process.resourcesPath, "icon.png") } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  // 링크는 앱 안이 아니라 기본 브라우저로 연다
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // 개발 서버 주소는 설치본에서 쓰지 않는다 (Pi Desktop과 같은 이유)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(here, "../renderer/index.html"));
}

if (isRunnerOnlyLaunch()) {
  // 로그인 때 띄운 실행: 창 없이 실행기만 확인하고 끝낸다 (실행기는 분리된 프로세스라 남는다)
  void app.whenReady().then(async () => {
    await ensureRunner();
    app.quit();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes(RUNNER_ONLY_ARG)) return;
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    await mkdir(paths.requests, { recursive: true });
    registerIpc();
    createWindow();
    const watcher = watchHome();
    app.on("will-quit", () => watcher?.close());
    // 자동 업데이트: 설치 직전에는 실행기를 멈춘다 (실행기가 Electron을 Node로 쓰는 경우 설치 파일을 잡고 있지 않게)
    const updater = new Updater(
      (state) => mainWindow?.webContents.send(IpcChannels.updateStateChanged, state),
      () => mainWindow,
      async () => {
        await runnerCommand(runnerScript(), "stop", runnerEnv());
      },
    );
    ipcMain.handle(IpcChannels.updateState, () => updater.current);
    ipcMain.handle(IpcChannels.checkForUpdates, (_e, interactive: boolean) => updater.check(interactive === true));
    ipcMain.handle(IpcChannels.confirmUpdate, () => updater.confirmUpdate());
    updater.start();
    // 창을 먼저 띄우고 실행기를 확인한다. 실행기는 앱을 닫아도 남는다.
    await ensureRunner();
    mainWindow?.webContents.send(IpcChannels.changed);
  });
  app.on("window-all-closed", () => app.quit());
}
