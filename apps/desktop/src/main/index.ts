import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Methods,
  type AuthCheckResult,
  type DataBackupResult,
  type CustomProviderForm,
  type ModelsFileView,
  type ModelsProbeResult,
  type FsListDirResult,
  type ResourcesView,
  type ResourceImportResult,
  type ImportedInspectResult,
  type ResourceExportResult,
  type ModelsExportResult,
  type ResourceImportParams,
  type ProjectTrustInfo,
  type ResourceFile,
  type ResourceKind,
  type ResourceWriteResult,
  type FsSearchResult,
  type ProviderInfo,
  type PiLatest,
  type PiStatus,
  type PiVersions,
  type PiUpdateResult,
  type PiUpdateTarget,
  type PiLocation,
  type PiResponse,
  type SessionAttachResult,
  type SessionHistoryParams,
  type SessionEventNotification,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionSummary,
  type StoredInspectResult,
  type StoredReadResult,
  type StoredSession,
} from "@pi-desktop/host-protocol";
import {
  IpcChannels,
  type AttachResult,
  type GithubCatalog,
  type GithubImportRequest,
  type ImportStatus,
  type GithubRepoRef,
  type ImportRecord,
  type OpenSessionRequest,
  type SshHostConfig,
  type TerminalOpenRequest,
} from "../shared/api";
import { TerminalService } from "./terminal";
import { terminalCommand } from "./terminal-command";
import { devSessionOverrides } from "./dev-overrides";
import { HostManager, LOCAL_HOST_ID, WSL_PREFIX } from "./host-manager";
import { SSH_PREFIX, sshExecutable } from "./ssh";
import { SshHostStore } from "./ssh-hosts";
import { packageDetail, searchPackages } from "./marketplace";
import { browseRepo, downloadFiles, fetchText } from "./github-catalog";
import { ImportStore } from "./imports";
import { compareLocal, compareUpstream, projectCwdOf } from "./import-status";
import { hostPathForExplorer } from "./host-path";
import { ReplayCollector } from "./replay-collector";

const here = fileURLToPath(new URL(".", import.meta.url));

/** 번들된 Host Agent 위치. 개발 중에는 워크스페이스의 빌드 결과를 쓴다. 패키징 경로는 M5에서 정한다. */
function agentScriptPath(): string {
  return process.env.PI_DESKTOP_AGENT_SCRIPT ?? resolve(app.getAppPath(), "../../packages/host-agent/dist/host-agent.mjs");
}

/** Agent 번들 옆의 package.json에서 버전을 읽는다 (원격 배포 파일 이름에 쓰임). */
function agentVersion(script: string): string {
  try {
    return String(JSON.parse(readFileSync(join(dirname(script), "..", "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

// 개발·E2E 검증용: 지정한 포트로 Chrome DevTools Protocol을 연다. 일반 실행에서는 열지 않는다.
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let hosts: HostManager | undefined;
const replays = new ReplayCollector<SessionEventNotification>();
const replayKey = (hostId: string, sessionId: string) => `${hostId}::${sessionId}`;

/** 렌더러로 알림을 보낸다. 창이 닫혀 있으면 버린다 (다시 열면 저널에서 재생하므로 잃지 않음). */
function sendToRenderer(channel: string, ...payload: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...payload);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "Pi Desktop",
    backgroundColor: "#16171d",
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, "../renderer/index.html"));
  }
}

const terminals = new TerminalService({ data: IpcChannels.terminalData, exit: IpcChannels.terminalExit });

function registerIpc(manager: HostManager, sshHosts: SshHostStore, imports: ImportStore): void {
  const conn = (hostId: string) => manager.get(hostId);

  // 내장 터미널: pi는 데몬이 찾은 Pi와 그 실행 node로 띄운다.
  ipcMain.handle(IpcChannels.terminalOpen, async (event, request: TerminalOpenRequest) => {
    const status = request.kind === "pi" ? await conn(request.hostId).request<PiStatus>(Methods.piStatus) : undefined;
    const runtime = status?.pi ? { pi: status.pi, nodePath: status.node.path } : undefined;
    const command = terminalCommand(
      {
        hostId: request.hostId,
        kind: request.kind,
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(request.args ? { args: request.args } : {}),
        ...(sshTarget(request.hostId) ? { ssh: sshTarget(request.hostId)! } : {}),
      },
      runtime,
    );
    return { id: terminals.open(event.sender, command, request.cols, request.rows), title: command.title };
  });
  ipcMain.on(IpcChannels.terminalWrite, (_event, id: string, data: string) => terminals.write(id, data));
  ipcMain.on(IpcChannels.terminalResize, (_event, id: string, cols: number, rows: number) => terminals.resize(id, cols, rows));
  ipcMain.on(IpcChannels.terminalClose, (_event, id: string) => terminals.close(id));

  ipcMain.handle(IpcChannels.listHosts, () => manager.listHosts());
  const sshTarget = (hostId: string) => {
    const host = hostId.startsWith(SSH_PREFIX) ? sshHosts.get(hostId.slice(SSH_PREFIX.length)) : undefined;
    return host ? { executable: sshExecutable(), host } : undefined;
  };
  ipcMain.handle(IpcChannels.listSshHosts, () => sshHosts.list());
  ipcMain.handle(IpcChannels.saveSshHost, (_event, host: SshHostConfig, previousName: string | undefined) => {
    sshHosts.save(host, previousName);
    // 고친 호스트는 다음에 쓸 때 새 설정으로 다시 연결한다.
    if (previousName !== undefined) manager.forget(`${SSH_PREFIX}${previousName}`);
  });
  ipcMain.handle(IpcChannels.removeSshHost, (_event, name: string) => {
    sshHosts.remove(name);
    manager.forget(`${SSH_PREFIX}${name}`);
  });
  ipcMain.handle(IpcChannels.connectHost, (_event, hostId: string) => conn(hostId).current);
  ipcMain.handle(IpcChannels.replaceAgent, (_event, hostId: string) => conn(hostId).replaceAgent());
  ipcMain.handle(IpcChannels.locatePi, (_event, hostId: string) =>
    conn(hostId).request<PiLocation>(Methods.piLocate, hostId === LOCAL_HOST_ID ? { piCliPath: process.env.PI_DESKTOP_PI_CLI } : {}),
  );
  // 저장된 세션 파일 검사·읽기·감시 (팔로우 모드). Pi CLI 경로는 SDK를 불러올 때만 필요하다.
  const storedParams = (hostId: string, path: string) =>
    hostId === LOCAL_HOST_ID && process.env.PI_DESKTOP_PI_CLI ? { path, piCliPath: process.env.PI_DESKTOP_PI_CLI } : { path };
  ipcMain.handle(IpcChannels.inspectStored, (_event, hostId: string, path: string) =>
    conn(hostId).request<StoredInspectResult>(Methods.storedInspect, { path }),
  );
  ipcMain.handle(IpcChannels.readStored, (_event, hostId: string, path: string) =>
    conn(hostId).request<StoredReadResult>(Methods.storedRead, storedParams(hostId, path)),
  );
  ipcMain.handle(IpcChannels.watchStored, async (_event, hostId: string, path: string) => {
    await conn(hostId).request(Methods.storedWatch, { path });
  });
  ipcMain.handle(IpcChannels.unwatchStored, async (_event, hostId: string, path: string) => {
    await conn(hostId).request(Methods.storedUnwatch, { path });
  });
  ipcMain.handle(IpcChannels.listHistory, (_event, hostId: string, cwd: string | undefined) => {
    const params: SessionHistoryParams = cwd ? { cwd } : {};
    // 개발용 덮어쓰기(격리된 Pi 설정)는 로컬 호스트에만 적용한다.
    if (hostId === LOCAL_HOST_ID) {
      const overrides = devSessionOverrides();
      if (overrides.piCliPath) params.piCliPath = overrides.piCliPath;
      const sessionDir = overrides.env?.PI_CODING_AGENT_SESSION_DIR;
      if (sessionDir) params.sessionDir = sessionDir;
    }
    return conn(hostId).request<StoredSession[]>(Methods.sessionHistory, params);
  });
  ipcMain.handle(IpcChannels.listSessions, (_event, hostId: string) =>
    conn(hostId).request<SessionSummary[]>(Methods.sessionList),
  );
  ipcMain.handle(IpcChannels.openSession, async (_event, hostId: string, request: OpenSessionRequest) => {
    // 개발용 덮어쓰기 값은 Windows 경로라서 로컬 호스트에만 적용한다.
    const overrides = hostId === LOCAL_HOST_ID ? devSessionOverrides() : {};
    const params: SessionOpenParams = { ...overrides, cwd: request.cwd };
    if (request.sessionFile) params.sessionFile = request.sessionFile;
    if (request.forkFrom) params.forkFrom = request.forkFrom;
    if (request.trust) params.trust = request.trust;
    const result = await conn(hostId).request<SessionOpenResult>(Methods.sessionOpen, params);
    return result.session;
  });
  ipcMain.handle(IpcChannels.attachSession, async (_event, hostId: string, sessionId: string, lastSeq: number) => {
    const key = replayKey(hostId, sessionId);
    const events = replays.begin(key);
    try {
      const result = await conn(hostId).request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq });
      const reply: AttachResult = { ...result, events };
      return reply;
    } finally {
      replays.end(key, events);
    }
  });
  ipcMain.handle(IpcChannels.closeSession, (_event, hostId: string, sessionId: string) =>
    conn(hostId).request(Methods.sessionClose, { sessionId }),
  );
  ipcMain.handle(IpcChannels.claimWriter, async (_event, hostId: string, sessionId: string) => {
    await conn(hostId).request(Methods.sessionClaimWriter, { sessionId });
  });
  ipcMain.handle(IpcChannels.clearExternalWrite, async (_event, hostId: string, sessionId: string) => {
    await conn(hostId).request(Methods.sessionClearExternalWrite, { sessionId });
  });
  ipcMain.handle(
    IpcChannels.sendCommand,
    (_event, hostId: string, sessionId: string, command: Record<string, unknown>) =>
      // `!` 셸 명령은 끝나야 응답이 오므로 시간 제한을 두지 않는다. 멈추려면 abort_bash를 보낸다.
      conn(hostId).request<PiResponse>(Methods.sessionSend, { sessionId, command }, command.type === "bash" ? 0 : undefined),
  );
  ipcMain.handle(
    IpcChannels.sendRecord,
    async (_event, hostId: string, sessionId: string, record: Record<string, unknown>) => {
      await conn(hostId).request(Methods.sessionSend, { sessionId, command: record, noResponse: true });
    },
  );
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.piStatus, (_event, hostId: string) => conn(hostId).request<PiStatus>(Methods.piStatus));
  ipcMain.handle(IpcChannels.piLatest, (_event, hostId: string, force: boolean) =>
    conn(hostId).request<PiLatest>(Methods.piLatest, { force }),
  );
  ipcMain.handle(IpcChannels.piUpdate, (_event, hostId: string, target: PiUpdateTarget, taskId: string, force: boolean) =>
    // 업데이트는 몇 분 걸릴 수 있어 응답 시간 제한을 두지 않는다 (데몬이 15분에서 멈춘다).
    conn(hostId).request<PiUpdateResult>(Methods.piUpdate, { target, taskId, force }, 0),
  );
  ipcMain.handle(IpcChannels.authProviders, (_event, hostId: string) =>
    conn(hostId).request<ProviderInfo[]>(Methods.authProviders),
  );
  ipcMain.handle(IpcChannels.authCheck, (_event, hostId: string, provider: string) =>
    conn(hostId).request<AuthCheckResult>(Methods.authCheck, { provider }),
  );
  // 키는 데몬으로만 넘기고 로그에 남기지 않는다.
  ipcMain.handle(IpcChannels.authSetApiKey, async (_event, hostId: string, provider: string, key: string) => {
    await conn(hostId).request(Methods.authSetApiKey, { provider, key });
  });
  ipcMain.handle(IpcChannels.authRemove, (_event, hostId: string, provider: string) =>
    conn(hostId).request<{ removed: boolean }>(Methods.authRemove, { provider }),
  );
  ipcMain.handle(IpcChannels.modelsRead, (_event, hostId: string) => conn(hostId).request<ModelsFileView>(Methods.modelsRead));
  ipcMain.handle(
    IpcChannels.modelsSaveProvider,
    async (_event, hostId: string, provider: CustomProviderForm, previousId: string | undefined) => {
      await conn(hostId).request(Methods.modelsSaveProvider, previousId ? { provider, previousId } : { provider });
    },
  );
  ipcMain.handle(IpcChannels.modelsRemoveProvider, (_event, hostId: string, id: string) =>
    conn(hostId).request<{ removed: boolean }>(Methods.modelsRemoveProvider, { id }),
  );
  ipcMain.handle(
    IpcChannels.modelsProbe,
    (_event, hostId: string, baseUrl: string, apiKey: string | undefined, providerId: string | undefined) =>
      conn(hostId).request<ModelsProbeResult>(Methods.modelsProbe, {
        baseUrl,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(providerId ? { providerId } : {}),
      }),
  );
  // 백업은 데이터 크기에 따라 오래 걸릴 수 있어 시간 제한을 두지 않는다 (데몬의 tar가 10분에서 멈춘다).
  ipcMain.handle(IpcChannels.dataBackup, (_event, hostId: string) =>
    conn(hostId).request<DataBackupResult>(Methods.dataBackup, undefined, 0),
  );
  ipcMain.handle(IpcChannels.dataDelete, async (_event, hostId: string, confirm: string) => {
    await conn(hostId).request(Methods.dataDelete, { confirm }, 0);
  });
  ipcMain.handle(IpcChannels.piVersions, (_event, hostId: string) => conn(hostId).request<PiVersions>(Methods.piVersions));
  ipcMain.handle(IpcChannels.searchFiles, (_event, hostId: string, cwd: string, query: string) =>
    conn(hostId).request<FsSearchResult>(Methods.fsSearch, { cwd, query, limit: 30 }),
  );
  ipcMain.handle(IpcChannels.listDir, (_event, hostId: string, path: string | undefined) =>
    conn(hostId).request<FsListDirResult>(Methods.fsListDir, path ? { path } : {}),
  );
  // 패키지 경로 해석에 npm 조회가 끼어 느릴 수 있어 넉넉히 기다린다.
  ipcMain.handle(IpcChannels.listResources, (_event, hostId: string, cwd: string) =>
    conn(hostId).request<ResourcesView>(Methods.resourcesList, { cwd }, 120_000),
  );
  ipcMain.handle(IpcChannels.marketSearch, (_event, query: string, from: number) => searchPackages(String(query ?? ""), Number(from) || 0));
  ipcMain.handle(IpcChannels.marketDetail, (_event, name: string) => packageDetail(String(name)));
  ipcMain.handle(IpcChannels.githubBrowse, (_event, spec: string) => browseRepo(String(spec)));
  ipcMain.handle(IpcChannels.githubText, (_event, repo: GithubRepoRef & { sha: string }, path: string) => fetchText(repo, String(path)));
  ipcMain.handle(IpcChannels.modelsExport, (_event, hostId: string, id: string) =>
    conn(hostId).request<ModelsExportResult>(Methods.modelsExportProvider, { id }),
  );
  ipcMain.handle(
    IpcChannels.modelsImport,
    async (_event, hostId: string, id: string, provider: Record<string, unknown>, replace: boolean) => {
      await conn(hostId).request(Methods.modelsImportProvider, { id, provider, ...(replace ? { replace: true } : {}) });
    },
  );
  ipcMain.handle(IpcChannels.exportResource, (_event, hostId: string, kind: "skill" | "prompt", path: string) =>
    conn(hostId).request<ResourceExportResult>(Methods.resourcesExport, { kind, path }, 120_000),
  );
  ipcMain.handle(IpcChannels.importResourceFiles, (_event, hostId: string, params: ResourceImportParams) =>
    conn(hostId).request<ResourceImportResult>(Methods.resourcesImport, params, 120_000),
  );
  ipcMain.handle(IpcChannels.listImports, (_event, hostId: string) => imports.list(hostId));
  // 이 PC가 GitHub에서 받아 그 호스트의 데몬에 쓰게 하고, 쓴 뒤에 출처를 기록한다.
  /** 이 PC가 GitHub에서 받아 그 호스트 데몬에 쓰고 출처를 기록한다. replace면 이전 것을 백업하고 바꾼다 */
  const importFromGithub = async (request: GithubImportRequest, replace = false): Promise<ImportRecord> => {
    const { item, repo } = request;
    const files =
      item.kind === "skill"
        ? await downloadFiles(repo, item.dir, item.files)
        : await downloadFiles(repo, ".", [{ path: item.path, sha: item.sha, size: item.size }]);
    const written = await conn(request.hostId).request<ResourceImportResult>(
      Methods.resourcesImport,
      { cwd: request.cwd, kind: item.kind, scope: request.scope, name: request.name, files, ...(replace ? { replace: true } : {}) },
      120_000,
    );
    const record: ImportRecord = {
      hostId: request.hostId,
      kind: item.kind,
      name: request.name,
      scope: request.scope,
      target: written.target,
      source: { owner: repo.owner, repo: repo.repo, sha: repo.sha, path: item.kind === "skill" ? item.dir : item.path },
      files: Object.fromEntries(item.kind === "skill" ? item.files.map((f) => [f.path, f.sha]) : [[item.path, item.sha]]),
      importedAt: Date.now(),
    };
    imports.add(record);
    return record;
  };
  ipcMain.handle(IpcChannels.githubImport, (_event, request: GithubImportRequest) => importFromGithub(request));

  const requireRecord = (hostId: string, target: string) => {
    const record = imports.get(hostId, target);
    if (!record) throw new Error(`가져온 기록이 없습니다: ${target}`);
    return record;
  };
  // 저장소마다 한 번만 최신을 훑고, 항목마다 그 호스트의 파일 해시와 비교한다.
  ipcMain.handle(IpcChannels.importStatus, async (_event, hostId: string): Promise<ImportStatus[]> => {
    const records = imports.list(hostId);
    const latest = new Map<string, Promise<GithubCatalog>>();
    return Promise.all(
      records.map(async (record): Promise<ImportStatus> => {
        const status: ImportStatus = { target: record.target, local: "same", localChanged: [], upstream: "unknown", upstreamChanged: [] };
        try {
          const inspected = await conn(hostId).request<ImportedInspectResult>(Methods.resourcesInspectImported, {
            target: record.target,
            kind: record.kind,
          });
          Object.assign(status, compareLocal(record, inspected));
          const key = `${record.source.owner}/${record.source.repo}`;
          if (!latest.has(key)) latest.set(key, browseRepo(key));
          Object.assign(status, compareUpstream(record, await latest.get(key)!));
        } catch (e) {
          status.error = e instanceof Error ? e.message : String(e);
        }
        return status;
      }),
    );
  });
  ipcMain.handle(IpcChannels.importUpdate, async (_event, hostId: string, target: string): Promise<ImportRecord> => {
    const record = requireRecord(hostId, target);
    const catalog = await browseRepo(`${record.source.owner}/${record.source.repo}`);
    const repo = { owner: catalog.owner, repo: catalog.repo, sha: catalog.sha };
    const skill = record.kind === "skill" ? catalog.skills.find((s) => s.dir === record.source.path) : undefined;
    const prompt = record.kind === "prompt" ? catalog.prompts.find((p) => p.path === record.source.path) : undefined;
    if (!skill && !prompt) throw new Error("원본 저장소에서 이 항목이 사라졌습니다");
    const cwd = record.scope === "project" ? projectCwdOf(record.target) : "";
    return importFromGithub(
      {
        hostId,
        cwd,
        scope: record.scope,
        name: record.name,
        repo,
        item: skill ? { kind: "skill", dir: skill.dir, files: skill.files } : { kind: "prompt", path: prompt!.path, sha: prompt!.sha, size: prompt!.size },
      },
      true,
    );
  });
  ipcMain.handle(IpcChannels.importRemove, async (_event, hostId: string, target: string) => {
    const record = requireRecord(hostId, target);
    await conn(hostId).request(Methods.resourcesRemoveImported, { target: record.target, kind: record.kind });
    imports.remove(hostId, target);
  });
  ipcMain.handle(
    IpcChannels.importDiff,
    async (_event, hostId: string, target: string, path: string, upstreamSha: string): Promise<{ local: string; upstream: string }> => {
      const record = requireRecord(hostId, target);
      const local = await conn(hostId)
        .request<string>(Methods.resourcesReadImported, { target: record.target, kind: record.kind, path })
        .catch(() => "");
      const repoPath = record.kind === "prompt" ? record.source.path : record.source.path === "." ? path : `${record.source.path}/${path}`;
      const upstream = await fetchText({ owner: record.source.owner, repo: record.source.repo, sha: upstreamSha }, repoPath).catch(() => "");
      return { local, upstream };
    },
  );
  ipcMain.handle(IpcChannels.getTrust, (_event, hostId: string, cwd: string) =>
    conn(hostId).request<ProjectTrustInfo>(Methods.trustGet, { cwd }),
  );
  ipcMain.handle(IpcChannels.setTrust, (_event, hostId: string, cwd: string, decision: boolean | null) =>
    conn(hostId).request<ProjectTrustInfo>(Methods.trustSet, { cwd, decision }),
  );
  ipcMain.handle(IpcChannels.readResource, (_event, hostId: string, cwd: string, path: string) =>
    conn(hostId).request<ResourceFile>(Methods.resourcesRead, { cwd, path }),
  );
  ipcMain.handle(
    IpcChannels.writeResource,
    (_event, hostId: string, cwd: string, path: string, content: string, baseMtime: number | undefined) =>
      conn(hostId).request<ResourceWriteResult>(Methods.resourcesWrite, {
        cwd,
        path,
        content,
        ...(typeof baseMtime === "number" ? { baseMtime } : {}),
      }),
  );
  ipcMain.handle(
    IpcChannels.createResource,
    (_event, hostId: string, cwd: string, kind: ResourceKind, scope: "user" | "project", name: string) =>
      conn(hostId).request<ResourceFile>(Methods.resourcesCreate, { cwd, kind, scope, name }),
  );
  ipcMain.handle(IpcChannels.revealFile, (_event, hostId: string, cwd: string, path: string) => {
    const target = hostPathForExplorer(hostId, cwd, path, WSL_PREFIX);
    if (!target) return false;
    shell.showItemInFolder(target);
    return true;
  });
}

app.whenReady().then(() => {
  const script = agentScriptPath();
  const sshHosts = new SshHostStore(join(app.getPath("userData"), "ssh-hosts.json"));
  hosts = new HostManager({
    agentScript: script,
    agentVersion: agentVersion(script),
    sshHosts,
    onState: (hostId, state) => sendToRenderer(IpcChannels.connectionChanged, hostId, state),
    // attach 중인 세션의 이벤트는 attach 결과에도 담는다. 같은 세션을 이미 보고 있는 다른 탭이 놓치지 않도록
    // 알림으로도 항상 보내고, attach하는 쪽은 결과를 먼저 적용한 뒤 순번으로 중복을 거른다 (replay-collector.ts).
    onSessionEvent: (hostId, n) => {
      replays.capture(replayKey(hostId, n.sessionId), n);
      sendToRenderer(IpcChannels.sessionEvent, hostId, n);
    },
    onSessionExit: (hostId, n) => sendToRenderer(IpcChannels.sessionExit, hostId, n),
    onUiResolved: (hostId, n) => sendToRenderer(IpcChannels.uiResolved, hostId, n),
    onStoredChanged: (hostId, n) => sendToRenderer(IpcChannels.storedChanged, hostId, n),
    onExternalWrite: (hostId, n) => sendToRenderer(IpcChannels.externalWrite, hostId, n),
    onWriterChanged: (hostId, n) => sendToRenderer(IpcChannels.writerChanged, hostId, n),
    onPiUpdateOutput: (hostId, n) => sendToRenderer(IpcChannels.piUpdateOutput, hostId, n),
  });
  registerIpc(hosts, sshHosts, new ImportStore(join(app.getPath("userData"), "imports.json")));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 각 호스트의 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (설계 §3.4).
app.on("will-quit", () => {
  terminals.dispose();
  hosts?.dispose();
});
