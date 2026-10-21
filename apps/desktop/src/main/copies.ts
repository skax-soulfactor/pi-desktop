import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CopyKind, CopyRecord, CopyRecordInput, CopyStatus } from "../shared/api";

/**
 * 다른 호스트로 복사한 기록 (설계 §5.9 "출처 기록", 앱 userData의 copies.json).
 * 원본 호스트·경로·시각과 파일별 git blob SHA를 남겨, 리소스 창에 "○○에서 복사됨 · 이후 원본이 바뀜"을 보인다.
 * 안내용일 뿐 자동으로 반영하지 않는다. 같은 대상 호스트·위치는 하나만 둔다 (다시 복사하면 바꾼다).
 */
export class CopyStore {
  private records: CopyRecord[];

  constructor(private readonly file: string) {
    this.records = readRecords(file);
  }

  /** 그 호스트로 복사해 온 기록 */
  listTo(hostId: string): CopyRecord[] {
    return this.records.filter((r) => r.toHostId === hostId).map((r) => ({ ...r }));
  }

  add(input: CopyRecordInput, now = Date.now()): CopyRecord {
    const record: CopyRecord = { ...input, files: fileShas(input.files), copiedAt: now };
    this.records = [...this.records.filter((r) => !(r.toHostId === record.toHostId && r.toPath === record.toPath)), record];
    this.write();
    return record;
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ copies: this.records }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

function readRecords(file: string): CopyRecord[] {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { copies?: unknown };
    return Array.isArray(data.copies)
      ? data.copies.filter(
          (r): r is CopyRecord =>
            typeof r === "object" &&
            r !== null &&
            typeof (r as CopyRecord).toHostId === "string" &&
            typeof (r as CopyRecord).toPath === "string" &&
            typeof (r as CopyRecord).files === "object",
        )
      : [];
  } catch {
    return [];
  }
}

/** git이 파일 내용에 매기는 SHA ("blob <크기>\0<내용>"의 SHA-1) */
export function fileShas(files: ReadonlyArray<{ path: string; contentBase64: string }>): Record<string, string> {
  return Object.fromEntries(
    files.map((f) => {
      const data = Buffer.from(f.contentBase64, "base64");
      return [f.path, createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex")];
    }),
  );
}

/**
 * 복사할 때와 같은 파일들인지. 파일 하나짜리는 이름이 바뀔 수 있어(프롬프트 이름, 파일 하나 스킬 → SKILL.md) 내용만 본다.
 */
export function sameFiles(before: Record<string, string>, now: Record<string, string>): boolean {
  const a = Object.entries(before);
  const b = Object.entries(now);
  if (a.length === 1 && b.length === 1) return a[0]![1] === b[0]![1];
  return a.length === b.length && a.every(([path, sha]) => now[path] === sha);
}

/** 다시 읽을 때 resources.export에 줄 종류 (사용자 AGENTS.md 등은 마크다운 파일 하나라 prompt로 읽는다) */
export function exportKindOf(kind: CopyKind): "skill" | "prompt" | "extension" {
  return kind === "context" ? "prompt" : kind;
}

/** 다시 읽은 결과로 상태를 정한다. 읽기 실패가 "파일이 없습니다"면 지워진 것이고, 그 밖의 실패는 모른다 */
export function compareCopy(
  record: CopyRecord,
  read: (side: "local" | "source") => Promise<Record<string, string>>,
): Promise<CopyStatus> {
  const side = async (which: "local" | "source"): Promise<{ state: "same" | "changed" | "missing" | "unknown"; error?: string }> => {
    try {
      return { state: sameFiles(record.files, await read(which)) ? "same" : "changed" };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return /파일이 없습니다|ENOENT/.test(message) ? { state: "missing" } : { state: "unknown", error: message };
    }
  };
  return Promise.all([side("local"), side("source")]).then(([local, source]) => {
    const status: CopyStatus = {
      toPath: record.toPath,
      local: local.state === "changed" ? "modified" : local.state,
      source: source.state === "missing" ? "gone" : source.state,
    };
    const error = local.error ?? source.error;
    if (error) status.error = error;
    return status;
  });
}
