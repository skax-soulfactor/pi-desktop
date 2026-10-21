import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ImportRecord } from "../shared/api";

/**
 * 가져온 스킬·프롬프트의 출처 기록 (설계 §4.6, 앱 userData의 imports.json).
 * 출처 저장소·커밋 SHA·파일별 git blob SHA를 남겨, 나중에 업데이트 확인과 로컬 수정 감지,
 * 깨끗한 제거에 쓴다. 같은 호스트·같은 위치는 하나만 둔다 (다시 가져오면 바꾼다).
 */
export class ImportStore {
  private records: ImportRecord[];

  constructor(private readonly file: string) {
    this.records = readRecords(file);
  }

  list(hostId?: string): ImportRecord[] {
    return this.records.filter((r) => hostId === undefined || r.hostId === hostId).map((r) => ({ ...r }));
  }

  add(record: ImportRecord): void {
    this.records = [...this.records.filter((r) => !(r.hostId === record.hostId && r.target === record.target)), record];
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ imports: this.records }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

function readRecords(file: string): ImportRecord[] {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { imports?: unknown };
    return Array.isArray(data.imports)
      ? data.imports.filter(
          (r): r is ImportRecord =>
            typeof r === "object" && r !== null && typeof (r as ImportRecord).hostId === "string" && typeof (r as ImportRecord).target === "string",
        )
      : [];
  } catch {
    return [];
  }
}
