import { mkdir, open, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { StoredDeleteResult } from "@pi-desktop/host-protocol";
import { movePath } from "./import-manage";

/**
 * 저장된 Pi 세션 파일을 지운다 (사이드바·열기 선택의 "삭제").
 * 바로 지우지 않고 backupDir로 옮겨, 잘못 지웠으면 원래 자리로 되돌릴 수 있게 한다.
 * 다른 파일을 지우지 않도록 확장자가 .jsonl이고 첫 줄이 Pi 세션 헤더({"type":"session"})인 파일만 다룬다.
 * 파일이 아직 없으면(메시지를 주고받기 전) 옮길 것이 없으므로 backup 없이 돌려준다.
 */
export async function deleteStoredSession(path: string, backupDir: string, now = new Date()): Promise<StoredDeleteResult> {
  if (!path.toLowerCase().endsWith(".jsonl")) throw new Error(`세션 파일(.jsonl)만 지울 수 있습니다: ${path}`);
  const info = await stat(path).catch(() => undefined);
  if (!info) return { path };
  if (!info.isFile()) throw new Error(`파일이 아닙니다: ${path}`);
  if (!(await isSessionFile(path))) throw new Error(`Pi 세션 파일이 아닙니다: ${path}`);
  await mkdir(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const backup = join(backupDir, `${stamp}-${basename(path)}`);
  await movePath(path, backup);
  return { path, backup };
}

/** 첫 줄이 Pi 세션 헤더인지 (파일 전체를 읽지 않고 앞부분만 본다) */
async function isSessionFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
    try {
      return (JSON.parse(first) as { type?: unknown }).type === "session";
    } catch {
      return false;
    }
  } finally {
    await handle.close();
  }
}
