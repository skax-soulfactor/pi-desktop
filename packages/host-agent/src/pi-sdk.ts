import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PiLocation, SessionHistoryParams, StoredSession } from "@pi-desktop/host-protocol";

/**
 * 설치된 Pi의 SDK를 동적으로 불러와 쓴다 (설계 §2 "SDK는 메타데이터 조회에만").
 *
 * Host Agent 번들에 Pi를 넣지 않으므로, 실행 시점에 그 호스트에 설치된 Pi 패키지에서 import한다.
 * 그래서 Pi가 업데이트되어 세션 저장 방식이 바뀌어도 그 버전의 코드가 그대로 처리한다.
 * 여기서 쓰는 SDK 표면은 최소한으로 둔다: SessionManager.list / listAll.
 */

/** 이 파일이 쓰는 Pi SDK의 일부 (타입은 Pi의 SessionInfo에서 필요한 필드만) */
interface PiSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

interface PiSdk {
  SessionManager: {
    list(cwd: string, sessionDir?: string): Promise<PiSessionInfo[]>;
    listAll(sessionDir?: string): Promise<PiSessionInfo[]>;
  };
}

const loaded = new Map<string, Promise<PiSdk>>();

/** Pi 패키지 디렉터리의 SDK 진입점(dist/index.js)을 불러온다. 같은 설치본은 한 번만 불러온다. */
export function loadPiSdk(pi: PiLocation): Promise<PiSdk> {
  let sdk = loaded.get(pi.packageDir);
  if (!sdk) {
    const entry = pathToFileURL(join(pi.packageDir, "dist", "index.js")).href;
    sdk = (import(entry) as Promise<PiSdk>).catch((error: unknown) => {
      loaded.delete(pi.packageDir);
      throw new Error(`Pi SDK를 불러오지 못했습니다 (${pi.version}): ${error instanceof Error ? error.message : String(error)}`);
    });
    loaded.set(pi.packageDir, sdk);
  }
  return sdk;
}

const DEFAULT_LIMIT = 200;
const FIRST_MESSAGE_MAX = 200;

/** Pi가 저장한 세션 목록. 최근 수정 순. */
export async function listStoredSessions(sdk: PiSdk, params: SessionHistoryParams): Promise<StoredSession[]> {
  const infos = params.cwd
    ? await sdk.SessionManager.list(params.cwd, params.sessionDir)
    : await sdk.SessionManager.listAll(params.sessionDir);
  return infos
    .map((info) => toStoredSession(info))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, params.limit ?? DEFAULT_LIMIT);
}

function toStoredSession(info: PiSessionInfo): StoredSession {
  const session: StoredSession = {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    created: toMs(info.created),
    modified: toMs(info.modified),
    messageCount: info.messageCount,
    firstMessage: (info.firstMessage ?? "").slice(0, FIRST_MESSAGE_MAX),
  };
  if (info.name) session.name = info.name;
  if (info.parentSessionPath) session.parentSessionPath = info.parentSessionPath;
  return session;
}

function toMs(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
