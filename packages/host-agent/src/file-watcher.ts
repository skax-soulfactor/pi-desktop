import { unwatchFile, watchFile, type Stats } from "node:fs";

export interface FileChange {
  path: string;
  size: number;
  modified: number;
}

/**
 * 파일 변경 감시 (팔로우 모드용, 설계 §5.4).
 *
 * fs.watch 대신 주기적으로 stat하는 fs.watchFile을 쓴다. WSL·네트워크 드라이브에서도 동작하고,
 * 다른 프로세스가 덧붙여 쓰는 경우를 빠짐없이 잡는다. 같은 파일을 여러 앱(창)이 보면 감시는 하나만 둔다.
 */
export class FileWatcher {
  private readonly listeners = new Map<string, Set<(change: FileChange) => void>>();

  constructor(private readonly intervalMs = 1000) {}

  /** 감시를 시작한다. 반환된 함수를 부르면 이 구독을 끝낸다. */
  watch(path: string, listener: (change: FileChange) => void): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
      watchFile(path, { interval: this.intervalMs, persistent: false }, (current: Stats, previous: Stats) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
        const change: FileChange = { path, size: current.size, modified: current.mtimeMs };
        for (const l of this.listeners.get(path) ?? []) l(change);
      });
    }
    set.add(listener);
    return () => this.release(path, listener);
  }

  private release(path: string, listener: (change: FileChange) => void): void {
    const set = this.listeners.get(path);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(path);
      unwatchFile(path);
    }
  }

  /** 지금 감시 중인 파일 수 (테스트용) */
  get size(): number {
    return this.listeners.size;
  }
}
