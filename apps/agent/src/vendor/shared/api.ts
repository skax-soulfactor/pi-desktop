import type { HostInfo } from "@pi-desktop/host-protocol/messages";

/** Pi Desktop apps/desktop/src/shared/api.ts의 ConnectionState·SshHostConfig만 복사했다 (vendor/README.md) */
export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting" }
  | {
      status: "connected";
      host: HostInfo;
      /**
       * 떠 있는 데몬이 앱의 번들보다 예전 것인데 Pi 세션이 돌고 있어 바꾸지 못했다 (설계 §3.4).
       * 세션이 모두 끝나면 앱이 알아서 바꾼다. liveSessions는 그때 실행 중이던 세션 수
       */
      agentUpdate?: { liveSessions: number };
    }
  | {
      status: "disconnected";
      reason: string;
      /** 다시 붙기를 시도하는 시각 (ms). 없으면 자동으로 다시 붙지 않는다 */
      retryAt?: number;
      /** 연달아 실패한 횟수와 자동으로 다시 붙는 최대 횟수 */
      failures?: number;
      maxRetries?: number;
      /** 연달아 실패해 자동으로 다시 붙기를 멈췄다. "다시 연결"(reconnectHost)로 다시 시작한다 */
      gaveUp?: boolean;
    };

export interface SshHostConfig {
  /** 화면에 보일 이름. 호스트 id("ssh:<이름>")에도 쓰여 겹칠 수 없다 */
  name: string;
  /** ssh에 넘기는 대상: user@host 또는 ~/.ssh/config의 Host 이름 */
  target: string;
  /** 비우면 ssh 기본값(22 또는 ~/.ssh/config) */
  port?: number;
}
