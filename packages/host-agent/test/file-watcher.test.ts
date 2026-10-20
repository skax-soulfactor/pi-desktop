import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileWatcher, type FileChange } from "../src/file-watcher";

const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("시간 초과");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("FileWatcher", () => {
  it("다른 쪽이 파일에 덧붙여 쓰면 알리고, 구독을 모두 끊으면 감시를 멈춘다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "watch-"));
    const path = join(dir, "s.jsonl");
    await writeFile(path, "a\n");
    const watcher = new FileWatcher(50);
    const a: FileChange[] = [];
    const b: FileChange[] = [];
    const offA = watcher.watch(path, (c) => a.push(c));
    const offB = watcher.watch(path, (c) => b.push(c));
    expect(watcher.size).toBe(1);

    await new Promise((r) => setTimeout(r, 120));
    await appendFile(path, "bb\n");
    await waitFor(() => a.length > 0 && b.length > 0);
    expect(a.at(-1)).toMatchObject({ path, size: 5 });

    offA();
    expect(watcher.size).toBe(1);
    offB();
    expect(watcher.size).toBe(0);
  });
});
