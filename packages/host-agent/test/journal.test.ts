import { describe, expect, it } from "vitest";
import { EventJournal } from "../src/journal";

const seqs = (journal: EventJournal, after: number) => journal.since(after).entries.map((e) => e.seq);

describe("EventJournal", () => {
  it("1부터 연속된 순번을 붙인다", () => {
    const journal = new EventJournal(10);
    expect(journal.append("a").seq).toBe(1);
    expect(journal.append("b").seq).toBe(2);
    expect(journal.lastSeq).toBe(2);
  });

  it("since(n)은 n보다 큰 순번만 돌려준다", () => {
    const journal = new EventJournal(10);
    for (const e of ["a", "b", "c"]) journal.append(e);
    expect(seqs(journal, 0)).toEqual([1, 2, 3]);
    expect(seqs(journal, 2)).toEqual([3]);
    expect(seqs(journal, 3)).toEqual([]);
    expect(journal.since(1).truncated).toBe(false);
  });

  it("용량을 넘으면 오래된 이벤트부터 버린다", () => {
    const journal = new EventJournal(3);
    for (let i = 0; i < 5; i++) journal.append(i);
    expect(journal.size).toBe(3);
    expect(journal.firstSeq).toBe(3);
    expect(seqs(journal, 2)).toEqual([3, 4, 5]);
  });

  it("버려진 구간 뒤부터 요청하면 truncated로 알리고 남은 것을 모두 준다", () => {
    const journal = new EventJournal(3);
    for (let i = 0; i < 5; i++) journal.append(i);
    const result = journal.since(0);
    expect(result.truncated).toBe(true);
    expect(result.entries.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("최신 순번보다 큰 값을 주면 빈 결과를 준다", () => {
    const journal = new EventJournal(3);
    journal.append("a");
    expect(journal.since(5)).toEqual({ entries: [], truncated: false });
  });

  it("비어 있는 저널은 truncated가 아니다", () => {
    expect(new EventJournal(3).since(0)).toEqual({ entries: [], truncated: false });
  });

  it("용량이 1보다 작으면 거부한다", () => {
    expect(() => new EventJournal(0)).toThrow();
  });
});
