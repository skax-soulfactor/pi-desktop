import { describe, expect, it } from "vitest";
import { createJsonlReader, encodeJsonl, JsonlSplitter } from "../src/framing";

function collect(chunks: Array<Buffer | string>): string[] {
  const lines: string[] = [];
  const splitter = new JsonlSplitter((line) => lines.push(line));
  for (const chunk of chunks) splitter.push(chunk);
  splitter.end();
  return lines;
}

describe("JsonlSplitter", () => {
  it("LF 기준으로 레코드를 나눈다", () => {
    expect(collect(['{"a":1}\n{"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("청크 경계에 걸친 레코드를 이어 붙인다", () => {
    expect(collect(['{"a":', "1}\n{", '"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("CRLF 입력의 CR을 제거한다", () => {
    expect(collect(['{"a":1}\r\n'])).toEqual(['{"a":1}']);
  });

  it("U+2028/U+2029는 경계로 취급하지 않는다", () => {
    const record = encodeJsonl({ text: "a b c" });
    expect(collect([record])).toEqual([record.trimEnd()]);
  });

  it("UTF-8 멀티바이트 문자가 청크 사이에서 잘려도 복원한다", () => {
    const bytes = Buffer.from('{"t":"한글"}\n', "utf8");
    // "한"(3바이트) 중간을 자른다
    const lines = collect([bytes.subarray(0, 7), bytes.subarray(7)]);
    expect(lines).toEqual(['{"t":"한글"}']);
  });

  it("마지막 줄에 LF가 없어도 end()에서 내보낸다", () => {
    expect(collect(['{"a":1}\n{"b":2}'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("빈 줄은 건너뛴다", () => {
    expect(collect(["\n\n{}\n\n"])).toEqual(["{}"]);
  });
});

describe("createJsonlReader", () => {
  it("JSON이 아닌 줄은 onInvalid로 알리고 다음 줄을 계속 처리한다", () => {
    const records: unknown[] = [];
    const invalid: string[] = [];
    const reader = createJsonlReader(
      (record) => records.push(record),
      (line) => invalid.push(line),
    );
    reader.push('not json\n{"ok":true}\n');
    expect(invalid).toEqual(["not json"]);
    expect(records).toEqual([{ ok: true }]);
  });
});
