import { StringDecoder } from "node:string_decoder";

/**
 * LF(`\n`) 하나를 레코드 경계로 쓰는 JSONL 스트림 분할기.
 *
 * Node.js `readline`은 U+2028/U+2029도 줄바꿈으로 취급하는데, 이 문자는 JSON 문자열 안에
 * 그대로 들어갈 수 있다. Pi RPC 문서도 이 점을 경고하므로 직접 분할한다.
 * 청크 경계에서 UTF-8 멀티바이트 문자가 잘리는 경우는 StringDecoder가 처리한다.
 */
export class JsonlSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      // CRLF로 들어온 입력도 받아들인다.
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  /** 스트림이 끝났을 때 남은 마지막 레코드(끝에 LF가 없는 경우)를 내보낸다. */
  end(): void {
    this.buffer += this.decoder.end();
    const rest = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
    this.buffer = "";
    if (rest.length > 0) this.onLine(rest);
  }
}

/** 값 하나를 JSONL 레코드 한 줄로 직렬화한다. */
export function encodeJsonl(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * JSON 파싱에 실패한 줄은 호출자에게 알리고 버린다.
 * 상대 프로세스가 진단 메시지를 stdout에 섞어 보내도 연결 전체가 죽지 않게 하기 위함이다.
 */
export function createJsonlReader(
  onRecord: (record: unknown) => void,
  onInvalid: (line: string, error: unknown) => void = () => {},
): JsonlSplitter {
  return new JsonlSplitter((line) => {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      onInvalid(line, error);
      return;
    }
    onRecord(record);
  });
}
