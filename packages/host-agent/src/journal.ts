/**
 * 세션 이벤트 저널 (설계 §3.4).
 *
 * Pi가 보낸 레코드마다 1부터 증가하는 순번(seq)을 붙여 보관한다.
 * 앱이 다시 붙을 때 마지막으로 받은 seq를 주면, 그 뒤의 이벤트를 빠짐없이 돌려준다.
 *
 * M0에서는 메모리 링버퍼만 쓴다. 용량을 넘으면 오래된 이벤트부터 버리고,
 * 버려진 구간을 요청받으면 `truncated: true`로 알려 앱이 스냅샷 복구를 하게 한다.
 * 디스크 저널은 M1에서 추가한다.
 */

export interface JournalEntry {
  seq: number;
  /** 데몬이 받은 시각 (ms) */
  at: number;
  event: unknown;
}

export interface ReplayResult {
  entries: JournalEntry[];
  /** 요청한 지점 바로 다음 이벤트가 이미 버려졌으면 true */
  truncated: boolean;
}

export class EventJournal {
  private readonly entries: JournalEntry[] = [];
  private seq = 0;

  constructor(private readonly capacity = 10_000) {
    if (capacity < 1) throw new Error("저널 용량은 1 이상이어야 합니다");
  }

  append(event: unknown, at = Date.now()): JournalEntry {
    const entry: JournalEntry = { seq: ++this.seq, at, event };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      // 배열 앞에서 한 번에 잘라내 shift 반복 비용을 줄인다.
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return entry;
  }

  /** `afterSeq`보다 큰 seq의 이벤트를 순서대로 돌려준다. */
  since(afterSeq: number): ReplayResult {
    const first = this.entries[0];
    if (!first) return { entries: [], truncated: afterSeq < this.seq };
    const truncated = afterSeq + 1 < first.seq;
    // seq는 연속이므로 인덱스를 바로 계산할 수 있다.
    const start = Math.max(0, afterSeq + 1 - first.seq);
    return { entries: this.entries.slice(start), truncated };
  }

  get lastSeq(): number {
    return this.seq;
  }

  get firstSeq(): number {
    return this.entries[0]?.seq ?? this.seq + 1;
  }

  get size(): number {
    return this.entries.length;
  }
}
