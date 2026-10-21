/**
 * JSON-RPC 2.0 메시지 타입과, 양방향으로 요청·알림을 주고받는 최소 구현.
 *
 * 앱(클라이언트)과 Host Agent 데몬(서버)이 같은 클래스를 쓴다.
 * 전송 계층(stdio, 소켓 등)은 모른다. 보낼 줄은 `send` 콜백으로 내보내고,
 * 받은 레코드는 `receive()`로 넣어준다.
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

/** JSON-RPC 2.0 표준 오류 코드와 이 프로젝트 전용 코드(-32000번대). */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** 연결이 끊겨 응답을 받을 수 없음 */
  ConnectionClosed: -32000,
  /** 요청 시간 초과 */
  Timeout: -32001,
  /** 존재하지 않는 세션 */
  SessionNotFound: -32010,
  /** Pi 실행 파일을 찾지 못함 */
  PiNotFound: -32011,
  /** 다른 앱이 이 세션의 입력 권한(writer)을 가지고 있음 (설계 §3.4) */
  NotWriter: -32012,
} as const;

/** 원격에서 돌아온 JSON-RPC 오류를 감싼 예외. */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }

  toObject(): JsonRpcErrorObject {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface JsonRpcPeerOptions {
  /** 직렬화된 메시지 한 개를 상대에게 보낸다. 프레이밍(줄바꿈)은 호출자가 맡는다. */
  send: (message: JsonRpcMessage) => void;
  /** 요청 기본 제한 시간(ms). 0이면 제한 없음. */
  defaultTimeoutMs?: number;
}

export class JsonRpcPeer {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();

  constructor(private readonly options: JsonRpcPeerOptions) {}

  /** 상대가 보낸 요청을 처리할 함수를 등록한다. 반환값이 결과, 예외가 오류 응답이 된다. */
  handle(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** 상대가 보낸 알림을 구독한다. 반환된 함수를 부르면 구독을 해제한다. */
  on(method: string, handler: NotificationHandler): () => void {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new JsonRpcError(ErrorCodes.ConnectionClosed, "연결이 닫혔습니다"));
    }
    const id = this.nextId++;
    const limit = timeoutMs ?? this.options.defaultTimeoutMs ?? 0;
    return new Promise<T>((resolve, reject) => {
      const timer =
        limit > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new JsonRpcError(ErrorCodes.Timeout, `요청 시간 초과: ${method}`));
            }, limit)
          : undefined;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.options.send(params === undefined
        ? { jsonrpc: "2.0", id, method }
        : { jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.options.send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
  }

  /** 상대에게서 받은 레코드 한 개를 처리한다. JSON-RPC 형태가 아니면 무시한다. */
  receive(record: unknown): void {
    if (!isObject(record) || record.jsonrpc !== "2.0") return;

    if (typeof record.method === "string") {
      if ("id" in record && isId(record.id)) {
        void this.dispatchRequest(record.id, record.method, record.params);
      } else {
        this.dispatchNotification(record.method, record.params);
      }
      return;
    }

    if ("id" in record && isId(record.id)) {
      const pending = this.pending.get(record.id);
      if (!pending) return;
      this.pending.delete(record.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (isObject(record.error)) {
        const error = record.error as unknown as JsonRpcErrorObject;
        pending.reject(new JsonRpcError(error.code, error.message, error.data));
      } else {
        pending.resolve(record.result);
      }
    }
  }

  /** 연결이 끊겼을 때 호출한다. 대기 중인 요청을 모두 실패 처리한다. */
  close(reason = "연결이 닫혔습니다"): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new JsonRpcError(ErrorCodes.ConnectionClosed, reason));
      this.pending.delete(id);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private async dispatchRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.sendError(id, new JsonRpcError(ErrorCodes.MethodNotFound, `알 수 없는 메서드: ${method}`));
      return;
    }
    try {
      const result = await handler(params);
      if (!this.closed) this.options.send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (error) {
      this.sendError(
        id,
        error instanceof JsonRpcError
          ? error
          : new JsonRpcError(ErrorCodes.InternalError, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private dispatchNotification(method: string, params: unknown): void {
    const handlers = this.notificationHandlers.get(method);
    if (!handlers) return;
    for (const handler of handlers) handler(params);
  }

  private sendError(id: JsonRpcId, error: JsonRpcError): void {
    if (!this.closed) this.options.send({ jsonrpc: "2.0", id, error: error.toObject() });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === "number" || typeof value === "string";
}
