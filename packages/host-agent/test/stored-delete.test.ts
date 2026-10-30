import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteStoredSession } from "../src/stored-delete";

const HEADER = `${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/tmp/x" })}\n`;

describe("deleteStoredSession — 세션 파일 삭제", () => {
  it("세션 파일을 백업 폴더로 옮기고 그 자리를 알려 준다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stored-delete-"));
    const file = join(dir, "2026-10-30_s1.jsonl");
    await writeFile(file, `${HEADER}{"type":"message"}\n`);
    const backups = join(dir, "backups");
    const result = await deleteStoredSession(file, backups, new Date("2026-10-30T07:30:00Z"));
    expect(existsSync(file)).toBe(false);
    expect(result).toEqual({ path: file, backup: join(backups, "20261030-073000-2026-10-30_s1.jsonl") });
    expect(readFileSync(result.backup!, "utf8")).toContain('"type":"message"');
  });

  it("파일이 아직 없으면(첫 메시지 전) 옮길 것 없이 돌려준다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stored-delete-"));
    expect(await deleteStoredSession(join(dir, "none.jsonl"), join(dir, "backups"))).toEqual({ path: join(dir, "none.jsonl") });
  });

  it("세션 파일이 아니면 지우지 않는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stored-delete-"));
    const notes = join(dir, "notes.txt");
    await writeFile(notes, HEADER);
    await expect(deleteStoredSession(notes, join(dir, "b"))).rejects.toThrow(/\.jsonl/);
    const other = join(dir, "data.jsonl");
    await writeFile(other, '{"type":"log"}\n');
    await expect(deleteStoredSession(other, join(dir, "b"))).rejects.toThrow(/Pi 세션 파일이 아닙니다/);
    expect(existsSync(notes) && existsSync(other)).toBe(true);
  });
});
