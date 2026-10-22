import { app, shell } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/api";
import { CHECK_INTERVAL_MS, FIRST_CHECK_MS, isLocalBuild, releaseUrl, updateMode } from "./update-policy";

const { autoUpdater } = electronUpdater;

const OWNER = "skax-soulfactor";
const REPO = "pi-desktop";

/**
 * 앱 자동 업데이트 (M5). GitHub Releases(electron-builder.yml의 publish)에 올라간 latest*.yml을 확인한다.
 *
 * 설치한 앱에서만 돈다(개발 실행은 disabled). 시작 15초 뒤와 6시간마다, 그리고 사용자가 요청할 때 확인한다.
 * 자동 설치가 되는 곳(Windows·AppImage)은 내려받아 두었다가 "다시 시작해 업데이트"로 바꾼다.
 * 그렇지 않은 곳(서명 없는 macOS·deb)은 새 버전을 알리고 릴리스 페이지를 연다.
 * 시험용으로 PI_DESKTOP_UPDATE_URL을 주면 그 주소(generic)에서 확인한다.
 */
export class Updater {
  private state: UpdateState;
  private readonly mode = updateMode(process.platform, process.env);

  constructor(private readonly broadcast: (state: UpdateState) => void) {
    const current = app.getVersion();
    this.state = !app.isPackaged
      ? { status: "disabled", current, mode: this.mode, error: "개발 실행에서는 업데이트를 확인하지 않습니다" }
      : isLocalBuild(current, process.env)
        ? { status: "disabled", current, mode: this.mode, error: "로컬 빌드에서는 업데이트를 확인하지 않습니다" }
        : { status: "idle", current, mode: this.mode };
  }

  start(): void {
    if (this.state.status === "disabled") return;
    const testUrl = process.env.PI_DESKTOP_UPDATE_URL;
    if (testUrl) autoUpdater.setFeedURL({ provider: "generic", url: testUrl });
    autoUpdater.autoDownload = this.mode === "auto";
    autoUpdater.autoInstallOnAppQuit = this.mode === "auto";
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => this.set({ status: "none", checkedAt: Date.now() }));
    autoUpdater.on("update-available", (info) =>
      this.set(
        this.mode === "auto"
          ? { status: "downloading", version: info.version, percent: 0 }
          : { status: "available", version: info.version, url: releaseUrl(OWNER, REPO, info.version) },
      ),
    );
    autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) => this.set({ status: "downloaded", version: info.version }));
    autoUpdater.on("error", (error) => this.set({ status: "error", error: error instanceof Error ? error.message : String(error) }));
    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref?.();
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref?.();
  }

  get current(): UpdateState {
    return this.state;
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === "disabled" || this.state.status === "downloading" || this.state.status === "downloaded") return this.state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    return this.state;
  }

  /** 내려받은 업데이트를 설치하며 다시 시작한다 */
  install(): void {
    if (this.state.status === "downloaded") autoUpdater.quitAndInstall();
  }

  /** 알리기만 하는 곳에서 릴리스 페이지를 연다 */
  async openRelease(): Promise<void> {
    const url = this.state.url ?? `https://github.com/${OWNER}/${REPO}/releases/latest`;
    await shell.openExternal(url);
  }

  private set(next: Partial<UpdateState> & { status: UpdateState["status"] }): void {
    const { error: _error, ...kept } = this.state;
    this.state = { ...kept, ...next, current: app.getVersion(), mode: this.mode };
    if (next.status !== "downloading" && next.status !== "downloaded" && next.status !== "available") {
      delete this.state.percent;
    }
    this.broadcast(this.state);
  }
}
