import type {
  SessionEventNotification,
  SessionExitNotification,
  SessionExternalWriteNotification,
  PiUpdateOutputNotification,
  SessionUiResolvedNotification,
  StoredChangedNotification,
} from "@pi-desktop/host-protocol";
import type { ConnectionState, HostDescriptor } from "../shared/api";
import { readFile } from "node:fs/promises";
import { agentBuildId } from "./agent-build";
import { HostConnection } from "./host-connection";
import { resolveNodeRuntime } from "./node-runtime";
import { listWslDistros, prepareWsl } from "./wsl";

export const LOCAL_HOST_ID = "local";
export const WSL_PREFIX = "wsl:";

export interface HostManagerOptions {
  /** 번들된 Host Agent 경로 */
  agentScript: string;
  agentVersion: string;
  onState: (hostId: string, state: ConnectionState) => void;
  onSessionEvent: (hostId: string, notification: SessionEventNotification) => void;
  onSessionExit: (hostId: string, notification: SessionExitNotification) => void;
  onUiResolved: (hostId: string, notification: SessionUiResolvedNotification) => void;
  onStoredChanged: (hostId: string, notification: StoredChangedNotification) => void;
  onExternalWrite: (hostId: string, notification: SessionExternalWriteNotification) => void;
  onPiUpdateOutput: (hostId: string, notification: PiUpdateOutputNotification) => void;
}

/**
 * 호스트(로컬, WSL 배포판들)마다 Host Agent 연결을 하나씩 관리한다 (설계 §3.1 HostManager).
 * 연결은 처음 쓰일 때 만든다. WSL은 띄우는 데 시간이 들어 고르지 않은 배포판까지 미리 깨우지 않는다.
 */
export class HostManager {
  private readonly connections = new Map<string, HostConnection>();

  constructor(private readonly options: HostManagerOptions) {}

  async listHosts(): Promise<HostDescriptor[]> {
    const local: HostDescriptor = { id: LOCAL_HOST_ID, kind: "local", label: localLabel() };
    const distros = await listWslDistros();
    return [local, ...distros.map((d): HostDescriptor => ({ id: `${WSL_PREFIX}${d}`, kind: "wsl", label: `WSL: ${d}` }))];
  }

  /** 호스트 연결을 돌려준다. 없으면 만들고 연결을 시작한다. */
  get(hostId: string): HostConnection {
    let connection = this.connections.get(hostId);
    if (!connection) {
      connection = new HostConnection({
        prepare: this.prepareFor(hostId),
        onState: (state) => this.options.onState(hostId, state),
        onSessionEvent: (n) => this.options.onSessionEvent(hostId, n),
        onSessionExit: (n) => this.options.onSessionExit(hostId, n),
        onUiResolved: (n) => this.options.onUiResolved(hostId, n),
        onStoredChanged: (n) => this.options.onStoredChanged(hostId, n),
        onExternalWrite: (n) => this.options.onExternalWrite(hostId, n),
        onPiUpdateOutput: (n) => this.options.onPiUpdateOutput(hostId, n),
      });
      this.connections.set(hostId, connection);
      connection.start();
    }
    return connection;
  }

  /** 아직 연결을 만들지 않은 호스트는 "idle"로 알린다. */
  stateOf(hostId: string): ConnectionState {
    return this.connections.get(hostId)?.current ?? { status: "idle" };
  }

  /** 앱 종료 시: 연결기만 정리한다. 각 호스트의 데몬과 Pi 세션은 계속 돈다 (설계 §3.4). */
  dispose(): void {
    for (const connection of this.connections.values()) connection.dispose();
  }

  private prepareFor(hostId: string) {
    if (hostId === LOCAL_HOST_ID) {
      return async () => {
        const runtime = await resolveNodeRuntime();
        // 연결할 때마다 번들을 해시한다. 개발 중 다시 빌드하면 예전 데몬을 바꾸도록.
        const agentBuild = agentBuildId(await readFile(this.options.agentScript));
        return { command: runtime.command, args: [this.options.agentScript, "connect"], env: runtime.env, agentBuild };
      };
    }
    if (hostId.startsWith(WSL_PREFIX)) {
      const distro = hostId.slice(WSL_PREFIX.length);
      return () => prepareWsl({ distro, agentScript: this.options.agentScript, agentVersion: this.options.agentVersion });
    }
    throw new Error(`알 수 없는 호스트: ${hostId}`);
  }
}

function localLabel(): string {
  switch (process.platform) {
    case "win32":
      return "로컬 (Windows)";
    case "darwin":
      return "로컬 (macOS)";
    default:
      return "로컬 (Linux)";
  }
}
