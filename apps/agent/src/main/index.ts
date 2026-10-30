import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Methods,
  type PiModelsResult,
  type PiResponse,
  type PiStatus,
  type SessionAttachResult,
  type SessionEventNotification,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionSummary,
  type StoredSession,
  type FsListDirResult,
  type TrashEmptyResult,
  type TrashItem,
} from "@pi-desktop/host-protocol";
import { AGENT_HOME_ENV } from "@pi-desktop/agent-kit/home";
import { isolatedPaths } from "@pi-desktop/pi-isolation";
import { loadTasks, tasksDir } from "@pi-desktop/agent-kit/tasks";
import { loadSchedules, schedulesPath, updateSchedules } from "@pi-desktop/agent-kit/schedules";
import type { TaskRecord } from "@pi-desktop/agent-kit/task-types";
import { loadElevationEnabled, saveElevationEnabled } from "@pi-desktop/agent-kit/elevation";
import { readSessionUsage, readUsageLog, summarizeUsage, rangeBuckets, type UsageRange } from "@pi-desktop/agent-kit/usage";
import {
  bulkUpdate,
  createEntry,
  exportMarkdown,
  knowledgeStats,
  loadAutoLearn,
  loadEntries,
  markReviewed,
  memoryDir,
  mergeEntries,
  needsReview,
  saveAutoLearn,
  updateEntry,
  type BulkAction,
  type EntryInput,
} from "@pi-desktop/agent-kit/memory";
import { buildKnowledgeSection } from "@pi-desktop/agent-kit/memory-recall";
import { deleteSkill, listSkills, saveSkill, userSkillsDir, type SkillInput } from "@pi-desktop/agent-kit/skills";
import { loadAudit, loadRules, removeRule } from "@pi-desktop/agent-kit/permissions";
import { agentBuildId } from "../vendor/main/agent-build";
import { devSessionOverrides } from "../vendor/main/dev-overrides";
import { searchSessions } from "./history";
import { approvePairing, checkPairings, forgetPeer, networkState, pairWith, previewPeer, rejectPairing, saveCard, setNetworkSettings, setPeerPolicy } from "./network";
import { DEFAULT_PEER_PORT, type CardDraft, type PeerPolicy, type PeerSettings } from "@pi-desktop/agent-kit/peers";
import { normalizeAddress } from "@pi-desktop/agent-kit/peers-protocol";
import { approvePeerTask, rejectPeerTask } from "@pi-desktop/agent-kit/peer-tasks";
import { generateCardDraft } from "@pi-desktop/agent-kit/card-draft";
import { readMcpFile, serverViews, updateMcpFile, withEnabled, withoutServer, withPreset } from "@pi-desktop/pi-isolation/mcp-file";
import { WEB_SEARCH_PRESETS, type McpCheckResult } from "@pi-desktop/pi-isolation/mcp-presets";
import { imageMimeType, MAX_IMAGE_BYTES } from "../renderer/attachments";
import { HostConnection, type LaunchSpec } from "../vendor/main/host-connection";
import { SshHostStore } from "../vendor/main/ssh-hosts";
import { listWslDistros } from "../vendor/main/wsl";
import type { SshHostConfig } from "../vendor/shared/api";
import { collectKit, LOCAL_HOST_ID, prepareSsh, prepareWsl, SSH_PREFIX, WSL_PREFIX, type HostPaths, type Prepared } from "./hosts";
import { schedulerDirFor, sessionParamsFor, sessionsDirFor } from "./host-session";
import { readHostChoice, writeHostChoice } from "./host-choice";
import { resolveNodeRuntime } from "../vendor/main/node-runtime";
import { ReplayCollector } from "../vendor/main/replay-collector";
import { IpcChannels, type AttachResult, type ChatSummary, type CurrentHost, type HostView, type RuleView, type SessionSource, type ImageAttachment } from "../shared/api";
import { findPiDesktop, installPiDesktop, openPiDesktop } from "./pi-desktop";
import type { PiSetupView } from "../shared/pi-setup";
import { TaskWatcher } from "./task-watcher";
import { appMenuTemplate } from "./app-menu";
import { OWNER, REPO, Updater } from "./updater";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * 에이전트 앱의 홈 (설계 DESIGN-AGENT.md §2.2, DESIGN-APPS.md §3). Host Agent 데몬 홈이기도 하다.
 * Pi Desktop의 `~/.pi-desktop`과 나눠, 따로 배포된 두 앱이 서로의 데몬을 교체하지 않게 한다.
 * 세션·스킬·프롬프트·MCP·AGENTS.md·agent-kit 상태도 여기 둔다. Pi의 로그인·모델·설정(`~/.pi/agent`)만 함께 쓴다.
 */
function agentHome(): string {
  return process.env.PI_DESKTOP_HOME || join(homedir(), ".pi-desktop-agent");
}

/** 번들된 Host Agent 위치. 설치본은 앱 리소스, 개발 중에는 워크스페이스의 빌드 결과 */
function agentScriptPath(): string {
  if (process.env.PI_DESKTOP_AGENT_SCRIPT) return process.env.PI_DESKTOP_AGENT_SCRIPT;
  if (app.isPackaged) return join(process.resourcesPath, "host-agent", "host-agent.mjs");
  return resolve(app.getAppPath(), "../../packages/host-agent/dist/host-agent.mjs");
}

/** pi-isolation 폴더. 앱 홈의 MCP·문맥 파일을 읽는 확장이 여기 있다 (agent-kit과 같은 방식으로 싣는다) */
function isolationDir(): string {
  if (process.env.PI_DESKTOP_PI_ISOLATION) return process.env.PI_DESKTOP_PI_ISOLATION;
  if (app.isPackaged) return join(process.resourcesPath, "pi-isolation");
  return resolve(app.getAppPath(), "../../packages/pi-isolation");
}

/** agent-kit 폴더. 확장은 대상 호스트(지금은 로컬)의 Pi가 이 경로에서 불러온다 */
function kitDir(): string {
  if (process.env.PI_DESKTOP_AGENT_KIT) return process.env.PI_DESKTOP_AGENT_KIT;
  if (app.isPackaged) return join(process.resourcesPath, "agent-kit");
  return resolve(app.getAppPath(), "../../packages/agent-kit");
}

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

/** 앱 홈의 세션·스킬·MCP 위치 (pi-isolation과 같은 규칙) */
const homePaths = () => isolatedPaths(agentHome());

/** agent-kit이 앱 홈을 알도록 주는 환경. 앱이 직접 부르는 agent-kit 함수에도 같은 값을 준다 */
function kitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [AGENT_HOME_ENV]: agentHome() };
}

/**
 * agent-kit 상태 폴더 (agent-kit permissions/store.ts의 dataDir와 같은 규칙: 앱 홈의 data/).
 * 지금은 로컬 호스트만 다루므로 앱이 직접 읽는다 (DESIGN-APPS.md §4: D4에서 데몬 명령으로 옮긴다).
 */
function agentDataDir(): string {
  if (process.env.PI_DESKTOP_AGENT_DATA) return process.env.PI_DESKTOP_AGENT_DATA;
  return join(agentHome(), "data");
}

/** 끝난 작업을 OS 알림으로 알린다. 창을 보고 있으면 목록이 바뀌는 것으로 충분하다 */
function notifyTask(task: TaskRecord): void {
  if (!Notification.isSupported()) return;
  // 피어가 작업을 맡기면 사람이 승인해야 시작되므로 창을 보고 있어도 알린다
  if (task.status === "waiting") {
    if (task.origin !== "peer-in" || task.approval !== "pending") return;
    new Notification({ title: `작업 요청: ${task.peer?.name ?? "피어"}`, body: `"${task.title}" — 네트워크 화면에서 폴더를 골라 승인하거나 거절하세요` }).show();
    return;
  }
  if (mainWindow?.isFocused()) return;
  const status = task.status === "done" ? "완료" : task.status === "failed" ? "실패" : "취소됨";
  const origin = task.origin === "schedule" ? "예약" : task.origin === "peer-out" ? `${task.peer?.name ?? "피어"}에게 맡긴 작업` : task.origin === "peer-in" ? `${task.peer?.name ?? "피어"}가 맡긴 작업` : "작업";
  const body = (task.status === "failed" ? task.error : task.result)?.slice(0, 200) ?? "";
  new Notification({ title: `${origin} ${status}: ${task.title}`, body }).show();
}

/** 이 PC를 호스트로 쓸 때의 경로 */
function localHostLabel(): string {
  return process.platform === "win32" ? "로컬 (Windows)" : process.platform === "darwin" ? "로컬 (macOS)" : "로컬 (Linux)";
}

function localPaths(): HostPaths {
  return { remote: false, home: agentHome(), kitDir: kitDir(), isolationDir: isolationDir(), userHome: homedir() };
}

/**
 * 지금 호스트 (설계 DESIGN-APPS.md §6 D3). 앱은 한 번에 한 호스트에 붙고, 설정에서 바꾸면 다시 연결한다.
 * hostPaths는 연결을 준비할 때(원격이면 kit을 올린 뒤) 정해진다.
 */
const hostChoiceFile = () => join(app.getPath("userData"), "agent-host.json");
let currentHostId = LOCAL_HOST_ID;
let hostPaths: HostPaths | undefined;
let sshHostStore: SshHostStore | undefined;
const sshHosts = () => (sshHostStore ??= new SshHostStore(join(app.getPath("userData"), "ssh-hosts.json")));

function requirePaths(): HostPaths {
  if (!hostPaths) throw new Error("호스트에 아직 연결되지 않았습니다");
  return hostPaths;
}

/** 이 화면은 아직 이 PC의 데이터만 다룬다 (DESIGN-APPS.md §6 D4에서 데몬 명령으로 옮긴다) */
function localOnly(what: string): void {
  if (hostPaths?.remote) throw new Error(`${what}은(는) 아직 원격 호스트에서 쓸 수 없습니다. 설정에서 호스트를 로컬로 바꾸면 쓸 수 있습니다`);
}

/** 데몬에 상주시키는 스케줄러 세션의 작업 폴더 (호스트마다 하나). 이 폴더로 연 세션이 있으면 이미 떠 있는 것으로 본다 */
function schedulerDir(): string {
  return schedulerDirFor(requirePaths());
}

/**
 * 세션 열기 파라미터 (host-session.ts). 개발용 덮어쓰기(저장소의 Pi, 격리된 Pi 설정, mock 프로바이더)는 로컬에서만 깐다.
 * 세션·스킬·프롬프트·MCP·AGENTS.md는 그 호스트의 앱 홈에서만 올린다 (DESIGN-APPS.md §3.1).
 */
async function sessionParams(cwd: string, extraEnv: Record<string, string> = {}): Promise<SessionOpenParams> {
  const paths = requirePaths();
  const local = !paths.remote;
  const data: Record<string, string> = local && process.env.PI_DESKTOP_AGENT_DATA ? { PI_DESKTOP_AGENT_DATA: process.env.PI_DESKTOP_AGENT_DATA } : {};
  return sessionParamsFor({ paths, localKitDir: kitDir(), cwd, ...(local ? { overrides: devSessionOverrides() } : {}), extraEnv: { ...data, ...extraEnv } });
}

/**
 * 예약을 돌리는 스케줄러 세션을 그 호스트의 데몬에 하나 띄워 둔다 (설계 DESIGN-AGENT.md §4 "예약·주기 작업", DESIGN-APPS.md §4 ④).
 * 데몬은 돌고 있는 세션이 있으면 꺼지지 않으므로, 앱을 닫아도 예약이 돈다. 이미 떠 있으면 아무것도 하지 않는다.
 */
async function ensureSchedulerSession(connection: HostConnection): Promise<void> {
  const paths = requirePaths();
  const cwd = schedulerDirFor(paths);
  const sessions = await connection.request<SessionSummary[]>(Methods.sessionList);
  if (sessions.some((s) => s.cwd === cwd && s.state === "running")) return;
  if (paths.remote) {
    // 원격 폴더는 데몬으로 만든다. 이미 있으면 오류가 나므로 무시한다
    await connection.request(Methods.fsMakeDir, { parent: paths.home, name: "scheduler" }).catch(() => undefined);
  } else {
    await mkdir(cwd, { recursive: true });
  }
  await connection.request<SessionOpenResult>(Methods.sessionOpen, await sessionParams(cwd, { PI_DESKTOP_AGENT_SCHEDULER: "1" }));
}

let mainWindow: BrowserWindow | undefined;
const replays = new ReplayCollector<SessionEventNotification>();

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** Host Agent 번들의 package.json에서 버전을 읽는다 (원격 배포 파일 이름에 쓰임). 설치본은 같은 폴더, 개발은 한 단계 위 (Pi Desktop과 같음) */
function agentVersion(script: string): string {
  for (const candidate of [join(dirname(script), "package.json"), join(dirname(script), "..", "package.json")]) {
    try {
      return String((JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown }).version ?? "0.0.0");
    } catch {
      // 다음 후보
    }
  }
  return "0.0.0";
}

/** 호스트마다 연결을 준비한다: 로컬은 바로, WSL·SSH는 Host Agent와 kit을 올린 뒤 (hosts.ts) */
async function prepareHost(hostId: string): Promise<LaunchSpec> {
  const script = agentScriptPath();
  if (hostId === LOCAL_HOST_ID) {
    const runtime = await resolveNodeRuntime();
    // 연결할 때마다 번들을 해시한다. 개발 중 다시 빌드하면 예전 데몬을 바꾸도록 (Pi Desktop과 같음).
    const agentBuild = agentBuildId(await readFile(script));
    hostPaths = localPaths();
    return { command: runtime.command, args: [script, "connect"], env: { ...runtime.env, PI_DESKTOP_HOME: agentHome() }, agentBuild };
  }
  const options = { agentScript: script, agentVersion: agentVersion(script), kit: () => collectKit(kitDir(), isolationDir()) };
  let prepared: Prepared;
  if (hostId.startsWith(WSL_PREFIX)) prepared = await prepareWsl(hostId.slice(WSL_PREFIX.length), options);
  else if (hostId.startsWith(SSH_PREFIX)) {
    const host = sshHosts().get(hostId.slice(SSH_PREFIX.length));
    if (!host) throw new Error(`등록되지 않은 SSH 호스트입니다: ${hostId.slice(SSH_PREFIX.length)}`);
    prepared = await prepareSsh(host, options);
  } else throw new Error(`알 수 없는 호스트입니다: ${hostId}`);
  hostPaths = prepared.paths;
  return prepared.spec;
}

function createConnection(hostId: string, onConnected: () => void): HostConnection {
  const ignore = () => {};
  return new HostConnection({
    prepare: () => prepareHost(hostId),
    onState: (state) => {
      sendToRenderer(IpcChannels.connectionChanged, state);
      if (state.status === "connected") onConnected();
    },
    onSessionEvent: (n) => {
      replays.capture(n.sessionId, n);
      sendToRenderer(IpcChannels.sessionEvent, n);
    },
    onSessionExit: (n) => sendToRenderer(IpcChannels.sessionExit, n),
    onUiResolved: (n) => sendToRenderer(IpcChannels.uiResolved, n),
    // 아래는 Pi Desktop 전용 기능(팔로우·여러 앱 입력 권한·Playground 등)이라 P0에서는 쓰지 않는다.
    onStoredChanged: ignore,
    onExternalWrite: ignore,
    onWriterChanged: ignore,
    onFilesChanged: ignore,
    onPlaygroundOutput: ignore,
    onPiUpdateOutput: ignore,
  });
}

function registerIpc(conn: () => HostConnection): void {
  ipcMain.handle(IpcChannels.connectionState, () => conn().current);
  ipcMain.handle(IpcChannels.piSetup, async (): Promise<PiSetupView> => {
    // Pi 관리는 Pi Desktop이 맡는다. 여기서는 데몬이 아는 상태를 모아 안내만 한다 (설계 DESIGN-AGENT.md §0)
    const status = await conn().request<PiStatus>(Methods.piStatus);
    const models = status.pi ? await conn().request<PiModelsResult>(Methods.piModels, undefined, 60_000).catch((e: unknown) => ({ models: [], error: String(e) })) : { models: [] };
    return {
      ...(status.pi ? { piVersion: status.pi.version } : {}),
      ...(status.piError ? { piError: status.piError } : {}),
      node: { version: status.node.version, required: status.node.required, ok: status.node.ok },
      ...(status.gitBash ? { gitBash: { found: status.gitBash.found } } : {}),
      authProviders: status.data.authProviders,
      models: models.models,
      ...(models.error ? { modelsError: models.error } : {}),
      ...(findPiDesktop() ? { piDesktopPath: findPiDesktop() } : {}),
      platform: status.platform,
    };
  });
  ipcMain.handle(IpcChannels.openPiDesktop, () => openPiDesktop());
  ipcMain.handle(IpcChannels.installPiDesktop, async () => {
    const result = await installPiDesktop(mainWindow, (received, total) => mainWindow?.webContents.send(IpcChannels.installProgress, received, total));
    return { status: result.status };
  });
  // 지식베이스·승인 규칙은 agent-kit의 같은 함수로 같은 파일을 읽고 고친다 (사람이 직접 고쳐도 되는 파일)
  const kb = () => memoryDir(agentDataDir());
  // 스킬: 앱 홈의 skills/를 고친다. 지운 것은 agent-kit 상태 폴더의 skills-trash/로
  const skillsDir = () => userSkillsDir(kitEnv());
  ipcMain.handle(IpcChannels.skillsList, () => listSkills(kitEnv()));
  ipcMain.handle(IpcChannels.skillSave, async (_event, previous: string | undefined, input: SkillInput) => {
    await saveSkill(skillsDir(), input, previous);
  });
  ipcMain.handle(IpcChannels.skillDelete, (_event, name: string) => deleteSkill(skillsDir(), name, join(agentDataDir(), "skills-trash")));
  ipcMain.handle(IpcChannels.skillOpenFolder, async () => {
    await mkdir(skillsDir(), { recursive: true });
    const error = await shell.openPath(skillsDir());
    if (error) throw new Error(error);
  });
  ipcMain.handle(IpcChannels.kbList, (_event, includeArchived: boolean) => loadEntries(kb(), { includeArchived: includeArchived === true }));
  ipcMain.handle(IpcChannels.kbSave, async (_event, id: string | undefined, input: EntryInput) => {
    if (!input.title?.trim() || !input.content?.trim()) throw new Error("제목과 본문을 적어 주세요");
    if (!id) return createEntry(kb(), { ...input, origin: "user" });
    // 사람이 고친 것은 확인된 것으로 본다
    const entry = await updateEntry(kb(), id, { ...input, unverified: false });
    if (!entry) throw new Error("그 항목을 찾지 못했습니다 (다른 곳에서 지웠을 수 있습니다)");
    return entry;
  });
  ipcMain.handle(IpcChannels.kbBulk, (_event, ids: string[], action: BulkAction, tag?: string) => bulkUpdate(kb(), ids, action, tag));
  ipcMain.handle(IpcChannels.kbMerge, async (_event, keepId: string, dropIds: string[]) => {
    await mergeEntries(kb(), keepId, dropIds);
  });
  ipcMain.handle(IpcChannels.kbReviewed, async (_event, id: string) => {
    await markReviewed(kb(), id);
  });
  ipcMain.handle(IpcChannels.kbReview, async () => needsReview(await loadEntries(kb())));
  ipcMain.handle(IpcChannels.kbStats, async () => knowledgeStats(await loadEntries(kb(), { includeArchived: true })));
  ipcMain.handle(IpcChannels.kbPreview, async (_event, prompt: string) => {
    // 클라우드 모델의 예산(8,000자)으로 보인다. 로컬 모델이면 창에 맞춰 더 줄어든다
    const { text, injected } = buildKnowledgeSection(await loadEntries(kb()), prompt ?? "", 8000);
    return { text: text ?? "", chars: text?.length ?? 0, injected: injected.length };
  });
  ipcMain.handle(IpcChannels.kbExport, async () => {
    const options = { defaultPath: join(homedir(), "지식베이스.md"), filters: [{ name: "Markdown", extensions: ["md"] }] };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return undefined;
    await writeFile(result.filePath, exportMarkdown(await loadEntries(kb(), { includeArchived: true })), "utf8");
    return result.filePath;
  });
  ipcMain.handle(IpcChannels.getElevation, () => loadElevationEnabled(agentDataDir()));
  ipcMain.handle(IpcChannels.setElevation, (_event, on: boolean) => saveElevationEnabled(agentDataDir(), on === true));
  ipcMain.handle(IpcChannels.getAutoLearn, () => loadAutoLearn(memoryDir(agentDataDir())));
  ipcMain.handle(IpcChannels.setAutoLearn, (_event, on: boolean) => saveAutoLearn(memoryDir(agentDataDir()), on === true));
  ipcMain.handle(IpcChannels.listRules, () => loadRules(agentDataDir()));
  ipcMain.handle(IpcChannels.removeRule, (_event, rule: RuleView) => removeRule(agentDataDir(), rule));
  ipcMain.handle(IpcChannels.listAudit, () => loadAudit(agentDataDir(), 100));
  const mcpFile = () => homePaths().mcp;
  ipcMain.handle(IpcChannels.listMcp, async () => serverViews(await readMcpFile(mcpFile())));
  ipcMain.handle(IpcChannels.addMcpPreset, (_event, id: string, key?: string) => {
    const preset = WEB_SEARCH_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`모르는 서버입니다: ${id}`);
    return updateMcpFile(mcpFile(), (file) => withPreset(file, preset, key));
  });
  ipcMain.handle(IpcChannels.setMcpEnabled, (_event, name: string, enabled: boolean) => updateMcpFile(mcpFile(), (file) => withEnabled(file, name, enabled === true)));
  ipcMain.handle(IpcChannels.removeMcp, (_event, name: string) => updateMcpFile(mcpFile(), (file) => withoutServer(file, name)));
  ipcMain.handle(IpcChannels.openMcpFile, async () => {
    const path = mcpFile();
    // 없으면 빈 설정을 만들어 연다
    await updateMcpFile(path, (file) => ({ mcpServers: {}, ...file }));
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IpcChannels.checkMcp, async (): Promise<McpCheckResult> => {
    localOnly("MCP 연결 확인");
    // pi mcp list: 켜진 서버마다 연결해 상태·도구·오류를 찍고, 연결 안 된 것이 있으면 1로 끝난다 (세션 없이 돈다).
    // pi mcp는 Pi 설정 폴더의 mcp.json만 읽으므로 이 실행에서만 설정 폴더를 앱 홈으로 바꾼다.
    // 그래서 OAuth 로그인이 필요한 서버는 로그인 안 됨으로 보일 수 있다 (세션은 Pi의 mcp-auth.json을 쓴다, pi-isolation 참고)
    const status = await conn().request<PiStatus>(Methods.piStatus);
    if (!status.pi) throw new Error(status.piError ?? "Pi를 찾지 못했습니다");
    const node = status.pi.nodePath ?? status.node.path;
    await mkdir(agentHome(), { recursive: true });
    return new Promise((resolve) => {
      execFile(
        node,
        [status.pi!.cliPath, "mcp", "list"],
        {
          cwd: agentHome(),
          env: { ...process.env, ...status.pi!.env, ...devSessionOverrides().env, PI_CODING_AGENT_DIR: agentHome() },
          timeout: 120_000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}${stderr ? `\n${stderr}` : ""}` }),
      );
    });
  });
  ipcMain.handle(IpcChannels.networkState, () => networkState(agentDataDir()));
  ipcMain.handle(IpcChannels.setNetworkSettings, (_event, settings: PeerSettings) => setNetworkSettings(agentDataDir(), settings));
  ipcMain.handle(IpcChannels.saveCard, (_event, card: CardDraft) => saveCard(agentDataDir(), card));
  ipcMain.handle(IpcChannels.previewPeer, (_event, address: string) => previewPeer(normalizeAddress(address, DEFAULT_PEER_PORT)));
  ipcMain.handle(IpcChannels.pairWith, async (_event, address: string) => {
    await pairWith(agentDataDir(), normalizeAddress(address, DEFAULT_PEER_PORT));
  });
  ipcMain.handle(IpcChannels.checkPairings, () => checkPairings(agentDataDir()));
  ipcMain.handle(IpcChannels.approvePairing, (_event, requestId: string) => approvePairing(agentDataDir(), requestId));
  ipcMain.handle(IpcChannels.rejectPairing, (_event, requestId: string) => rejectPairing(agentDataDir(), requestId));
  ipcMain.handle(IpcChannels.forgetPeer, (_event, id: string) => forgetPeer(agentDataDir(), id));
  ipcMain.handle(IpcChannels.approvePeerTask, (_event, id: string, cwd: string) => approvePeerTask(agentDataDir(), id, cwd));
  ipcMain.handle(IpcChannels.rejectPeerTask, (_event, id: string) => rejectPeerTask(agentDataDir(), id));
  ipcMain.handle(IpcChannels.setPeerPolicy, (_event, id: string, policy: PeerPolicy) => setPeerPolicy(agentDataDir(), id, policy));
  ipcMain.handle(IpcChannels.usageSummary, async (_event, range: UsageRange) => {
    const now = new Date();
    const { from } = rangeBuckets(range, now);
    const [sessions, offSession] = await Promise.all([readSessionUsage(homePaths().sessions, from), readUsageLog(agentDataDir(), from)]);
    return summarizeUsage([...sessions, ...offSession], range, now);
  });
  ipcMain.handle(IpcChannels.listSessions, async (): Promise<ChatSummary[]> => {
    if (!hostPaths) return [];
    const sessions = await conn().request<SessionSummary[]>(Methods.sessionList);
    const chats = sessions.filter((s) => s.state === "running" && s.cwd !== schedulerDir()).sort((a, b) => b.startedAt - a.startedAt);
    // 이름은 Pi 세션 파일에 있다 (set_session_name). 이름을 못 읽어도 목록은 보인다
    return Promise.all(
      chats.map(async (s): Promise<ChatSummary> => {
        try {
          const state = await conn().request<PiResponse>(Methods.sessionSend, { sessionId: s.sessionId, command: { type: "get_state" } }, 3000);
          const name = (state.data as { sessionName?: string } | undefined)?.sessionName;
          return name ? { ...s, name } : s;
        } catch {
          return s;
        }
      }),
    );
  });
  ipcMain.handle(IpcChannels.closeSession, async (_event, sessionId: string) => {
    await conn().request(Methods.sessionClose, { sessionId });
  });
  // 호스트 (설계 DESIGN-APPS.md §6 D3): 고르기, SSH 호스트 관리, 그 호스트의 폴더 훑기
  ipcMain.handle(IpcChannels.listHosts, async (): Promise<HostView[]> => [
    { id: LOCAL_HOST_ID, kind: "local", label: localHostLabel() },
    ...(await listWslDistros()).map((d): HostView => ({ id: `${WSL_PREFIX}${d}`, kind: "wsl", label: `WSL: ${d}` })),
    ...sshHosts().list().map((h): HostView => ({ id: `${SSH_PREFIX}${h.name}`, kind: "ssh", label: `SSH: ${h.name}` })),
  ]);
  ipcMain.handle(IpcChannels.currentHost, (): CurrentHost => ({ id: currentHostId, remote: currentHostId !== LOCAL_HOST_ID }));
  ipcMain.handle(IpcChannels.setHost, (_event, hostId: string) => switchHost(hostId));
  ipcMain.handle(IpcChannels.listSshHosts, () => sshHosts().list());
  ipcMain.handle(IpcChannels.saveSshHost, (_event, host: SshHostConfig, previousName?: string) => sshHosts().save(host, previousName));
  ipcMain.handle(IpcChannels.removeSshHost, async (_event, name: string) => {
    if (currentHostId === `${SSH_PREFIX}${name}`) throw new Error("지금 쓰는 호스트입니다. 다른 호스트로 바꾼 뒤 지우세요");
    sshHosts().remove(name);
  });
  ipcMain.handle(IpcChannels.listDir, (_event, _hostId: string, path?: string) => conn().request<FsListDirResult>(Methods.fsListDir, path ? { path } : {}));
  ipcMain.handle(IpcChannels.makeDir, async (_event, _hostId: string, parent: string, name: string) =>
    (await conn().request<{ path: string }>(Methods.fsMakeDir, { parent, name })).path,
  );
  ipcMain.handle(IpcChannels.defaultCwd, () => hostPaths?.userHome ?? homedir());
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const, "createDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.pickFiles, async () => {
    const options = { properties: ["openFile" as const, "multiSelections" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IpcChannels.readImages, (_event, paths: string[]) =>
    Promise.all(
      paths.map(async (path): Promise<ImageAttachment> => {
        const name = basename(path);
        const mimeType = imageMimeType(path) ?? "application/octet-stream";
        try {
          const size = (await stat(path)).size;
          if (size > MAX_IMAGE_BYTES) return { name, mimeType, error: `${(size / 1024 / 1024).toFixed(1)}MB라 너무 큽니다 (5MB까지)` };
          return { name, mimeType, data: (await readFile(path)).toString("base64") };
        } catch (error) {
          return { name, mimeType, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    ),
  );
  ipcMain.handle(IpcChannels.listTasks, async () => (await loadTasks(tasksDir(agentDataDir()))).slice(0, 30));
  ipcMain.handle(IpcChannels.listSchedules, () => loadSchedules(schedulesPath(agentDataDir())));
  ipcMain.handle(IpcChannels.setScheduleEnabled, async (_event, id: string, enabled: boolean) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.map((s) => (s.id === id ? { ...s, enabled } : s)));
  });
  ipcMain.handle(IpcChannels.removeSchedule, async (_event, id: string) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.filter((s) => s.id !== id));
  });
  ipcMain.handle(IpcChannels.openSession, async (_event, cwd: string, from?: SessionSource) => {
    // forkFrom: 다른 폴더로 대화를 옮길 때 지금 세션 파일에서 분기한다 (pi --fork, 원래 세션 파일은 그대로)
    // sessionFile: 지난 대화를 그 파일 그대로 이어서 연다
    const params = await sessionParams(cwd);
    const result = await conn().request<SessionOpenResult>(Methods.sessionOpen, { ...params, ...from });
    return result.session;
  });
  /** 지난 대화. 그 호스트의 앱 홈 세션 폴더만 본다 (Pi Desktop·터미널 pi의 세션은 섞지 않는다) */
  const history = async (): Promise<StoredSession[]> => {
    const paths = requirePaths();
    const overrides = paths.remote ? {} : devSessionOverrides();
    const stored = await conn().request<StoredSession[]>(
      Methods.sessionHistory,
      { sessionDir: sessionsDirFor(paths), limit: 300, ...(overrides.piCliPath ? { piCliPath: overrides.piCliPath } : {}) },
      30_000,
    );
    return stored.filter((s) => s.cwd !== schedulerDir());
  };
  ipcMain.handle(IpcChannels.listHistory, history);
  ipcMain.handle(IpcChannels.suggestCard, async (_event, current: CardDraft) => {
    localOnly("카드 초안 만들기");
    // 카드 초안: Pi를 한 번(--print, 도구·확장 없음) 불러 만든다. 재료는 사실·교훈 기억과 사용자가 붙인 대화 이름뿐
    const status = await conn().request<PiStatus>(Methods.piStatus);
    if (!status.pi) throw new Error(status.piError ?? "Pi를 찾지 못했습니다");
    const memories = (await loadEntries(memoryDir(agentDataDir()))).map((m) => ({ type: m.type, title: m.title, tags: m.tags }));
    const sessionNames = (await history().catch(() => [])).flatMap((h) => (h.name ? [h.name] : [])).slice(0, 50);
    const cwd = await mkdtemp(join(tmpdir(), "agent-card-"));
    return generateCardDraft(
      { command: status.pi.nodePath ?? status.node.path, args: [status.pi.cliPath, ...(devSessionOverrides().piArgs ?? [])], env: { ...process.env, ...status.pi.env, ...devSessionOverrides().env } },
      { memories, sessionNames, current },
      cwd,
    );
  });
  // 아카이브·휴지통 (설계 DESIGN-APPS.md §3.2). 데몬 홈(~/.pi-desktop-agent)의 것이라 Pi Desktop과 섞이지 않는다
  ipcMain.handle(IpcChannels.deleteChat, async (_event, path: string) => {
    const sessions = await conn().request<SessionSummary[]>(Methods.sessionList);
    if (sessions.some((s) => s.state === "running" && s.sessionFile === path)) throw new Error("열려 있는 대화입니다. 대화를 닫은 뒤 지우세요");
    await conn().request(Methods.storedDelete, { path });
  });
  ipcMain.handle(IpcChannels.setArchived, async (_event, path: string, archived: boolean) => {
    await conn().request(Methods.archiveSet, { path, archived: archived === true });
  });
  ipcMain.handle(IpcChannels.listTrash, () => conn().request<TrashItem[]>(Methods.trashList));
  ipcMain.handle(IpcChannels.restoreTrash, async (_event, id: string) => {
    await conn().request(Methods.trashRestore, { id });
  });
  ipcMain.handle(IpcChannels.emptyTrash, async (_event, ids?: string[]) =>
    (await conn().request<TrashEmptyResult>(Methods.trashEmpty, ids ? { ids } : {})).removed,
  );
  ipcMain.handle(IpcChannels.searchHistory, async (_event, query: string) =>
    // 본문 검색은 세션 파일을 이 PC에서 읽는다. 원격은 이름·첫 메시지로만 거른다 (D4)
    hostPaths?.remote ? Promise.reject(new Error("원격 호스트에서는 아직 대화 내용까지 찾을 수 없습니다. 이름·첫 메시지로 걸러 주세요")) :
    searchSessions((await history()).filter((s) => !s.archived), query, (path) => readFile(path, "utf8")),
  );
  ipcMain.handle(IpcChannels.attachSession, async (_event, sessionId: string, lastSeq: number) => {
    // attach 도중 알림으로 온 이벤트도 결과에 담는다. 렌더러는 순번으로 중복을 거른다 (replay-collector.ts).
    const events = replays.begin(sessionId);
    try {
      const result = await conn().request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq });
      const reply: AttachResult = { ...result, events };
      return reply;
    } finally {
      replays.end(sessionId, events);
    }
  });
  ipcMain.handle(IpcChannels.sendCommand, (_event, sessionId: string, command: Record<string, unknown>) =>
    conn().request<PiResponse>(Methods.sessionSend, { sessionId, command }),
  );
  ipcMain.handle(IpcChannels.sendRecord, async (_event, sessionId: string, record: Record<string, unknown>) => {
    await conn().request(Methods.sessionSend, { sessionId, command: record, noResponse: true });
  });
}

/** 창 아이콘. 개발 실행은 build/icon.png, Linux 설치본은 실행 파일에 아이콘이 없어 리소스의 것을 준다 (Pi Desktop과 같음) */
function windowIcon(): { icon?: string } {
  if (!app.isPackaged) return { icon: join(app.getAppPath(), "build", "icon.png") };
  return process.platform === "linux" ? { icon: join(process.resourcesPath, "icon.png") } : {};
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: "Pi Desktop Agent",
    backgroundColor: "#16171d",
    ...windowIcon(),
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 응답 속 링크가 앱 창을 다른 페이지로 바꾸지 않게 한다. http(s) 링크만 외부 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  // 개발 서버 주소는 개발 실행에서만 쓴다 (설치본이 환경 변수의 주소를 열면 그 페이지가 preload API를 갖게 된다).
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, "../renderer/index.html"));
  }
}

let connection: HostConnection | undefined;

/** 고른 호스트에 붙는 연결을 만든다. 붙으면 그 호스트의 스케줄러 세션을 확인한다 */
function connectTo(hostId: string): HostConnection {
  const created = createConnection(hostId, () => {
    // 실패해도 대화는 쓸 수 있어야 한다. 다음에 다시 붙을 때 다시 시도한다
    ensureSchedulerSession(created).catch((error: unknown) => console.error("스케줄러 세션을 띄우지 못했다:", error));
  });
  return created;
}

/**
 * 호스트를 바꾼다: 고른 것을 저장하고, 지금 연결기를 끝내고 새 호스트에 붙는다.
 * 앞 호스트의 데몬과 대화는 그 호스트에서 계속 돈다 (돌아오면 다시 보인다). 화면은 새로 읽는다.
 */
async function switchHost(hostId: string): Promise<void> {
  if (hostId === currentHostId) return;
  if (hostId.startsWith(SSH_PREFIX) && !sshHosts().get(hostId.slice(SSH_PREFIX.length))) throw new Error("등록되지 않은 SSH 호스트입니다");
  writeHostChoice(hostChoiceFile(), hostId);
  currentHostId = hostId;
  connection?.dispose();
  hostPaths = undefined;
  connection = connectTo(hostId);
  connection.start();
  mainWindow?.webContents.reload();
}

app.whenReady().then(() => {
  currentHostId = readHostChoice(hostChoiceFile());
  connection = connectTo(currentHostId);
  registerIpc(() => connection!);

  // 자동 업데이트 (Pi Desktop Mate와 같은 방식: 가장 높은 agent-v* 릴리스를 generic으로)
  const updater = new Updater((state) => sendToRenderer(IpcChannels.updateStateChanged, state), () => mainWindow);
  ipcMain.handle(IpcChannels.updateState, () => updater.current);
  ipcMain.handle(IpcChannels.checkForUpdates, (_event, interactive?: boolean) => updater.check(interactive === true));
  ipcMain.handle(IpcChannels.confirmUpdate, () => updater.confirmUpdate());
  updater.start();

  // 기능 화면은 사이드바가 아니라 메뉴바에서 연다 (app-menu.ts)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate(process.platform, app.isPackaged, {
        command: (id) => sendToRenderer(IpcChannels.menuCommand, id),
        checkForUpdates: () => void updater.check(true),
        openReleases: () => void shell.openExternal(`https://github.com/${OWNER}/${REPO}/releases`),
        about: () =>
          void dialog.showMessageBox({
            type: "info",
            title: "Pi Desktop Agent 정보",
            message: `Pi Desktop Agent ${app.getVersion()}`,
            detail: `Pi를 엔진으로 쓰는 데스크톱 에이전트 (기능은 agent-kit)\nElectron ${process.versions.electron} · Node ${process.versions.node}\nhttps://github.com/${OWNER}/${REPO}`,
          }),
      }),
    ),
  );
  // Windows 작업 표시줄·알림의 앱 식별자. 설치 프로그램이 만든 바로 가기는 electron-builder의 appId를 쓰므로
  // 같은 값이어야 한다. 다르면 실행 중인 창이 다른 앱으로 묶여 기본 Electron 아이콘이 보인다.
  app.setAppUserModelId("dev.pi-desktop.agent");
  new TaskWatcher(
    () => loadTasks(tasksDir(agentDataDir())),
    notifyTask,
    () => sendToRenderer(IpcChannels.tasksChanged, null),
  ).start();
  createWindow();
  connection!.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (DESIGN.md §3.4).
app.on("will-quit", () => connection?.dispose());
