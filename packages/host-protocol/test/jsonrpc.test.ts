import { describe, expect, it } from "vitest";
import { ErrorCodes, JsonRpcError, JsonRpcPeer } from "../src/jsonrpc";

/** 메모리 안에서 서로 연결된 두 peer를 만든다. 실제 전송처럼 JSON 직렬화를 거친다. */
function pair() {
  let a!: JsonRpcPeer;
  let b!: JsonRpcPeer;
  a = new JsonRpcPeer({ send: (m) => queueMicrotask(() => b.receive(JSON.parse(JSON.stringify(m)))) });
  b = new JsonRpcPeer({ send: (m) => queueMicrotask(() => a.receive(JSON.parse(JSON.stringify(m)))) });
  return { a, b };
}

describe("JsonRpcPeer", () => {
  it("요청에 대한 결과를 돌려준다", async () => {
    const { a, b } = pair();
    b.handle("math.add", (params) => {
      const { x, y } = params as { x: number; y: number };
      return x + y;
    });
    await expect(a.request("math.add", { x: 1, y: 2 })).resolves.toBe(3);
  });

  it("비동기 핸들러도 처리한다", async () => {
    const { a, b } = pair();
    b.handle("slow", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "done";
    });
    await expect(a.request("slow")).resolves.toBe("done");
  });

  it("핸들러 예외는 오류 응답이 된다", async () => {
    const { a, b } = pair();
    b.handle("fail", () => {
      throw new JsonRpcError(ErrorCodes.SessionNotFound, "없는 세션");
    });
    await expect(a.request("fail")).rejects.toMatchObject({
      code: ErrorCodes.SessionNotFound,
      message: "없는 세션",
    });
  });

  it("일반 Error는 InternalError로 바꾼다", async () => {
    const { a, b } = pair();
    b.handle("boom", () => {
      throw new Error("터짐");
    });
    await expect(a.request("boom")).rejects.toMatchObject({ code: ErrorCodes.InternalError, message: "터짐" });
  });

  it("등록되지 않은 메서드는 MethodNotFound", async () => {
    const { a } = pair();
    await expect(a.request("nope")).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
  });

  it("알림을 구독자에게 전달하고, 해제하면 더 이상 받지 않는다", async () => {
    const { a, b } = pair();
    const got: unknown[] = [];
    const off = b.on("tick", (p) => got.push(p));
    a.notify("tick", 1);
    await new Promise((r) => setTimeout(r, 0));
    off();
    a.notify("tick", 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([1]);
  });

  it("제한 시간이 지나면 Timeout으로 실패한다", async () => {
    const a = new JsonRpcPeer({ send: () => {} });
    await expect(a.request("never", undefined, 10)).rejects.toMatchObject({ code: ErrorCodes.Timeout });
  });

  it("close()하면 대기 중인 요청이 ConnectionClosed로 실패하고 이후 요청도 거부된다", async () => {
    const a = new JsonRpcPeer({ send: () => {} });
    const pending = a.request("never");
    a.close();
    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.ConnectionClosed });
    await expect(a.request("again")).rejects.toMatchObject({ code: ErrorCodes.ConnectionClosed });
  });

  it("JSON-RPC가 아닌 레코드는 무시한다", () => {
    const a = new JsonRpcPeer({ send: () => {} });
    expect(() => a.receive({ hello: "world" })).not.toThrow();
    expect(() => a.receive(null)).not.toThrow();
  });
});
