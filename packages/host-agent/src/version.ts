import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

declare const __AGENT_VERSION__: string | undefined;

/** 번들할 때 package.json 버전이 주입된다. 테스트처럼 번들 없이 실행하면 "dev". */
export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ === "string" ? __AGENT_VERSION__ : "dev";

/**
 * 실행 중인 Agent 번들을 가리키는 빌드 식별자: 번들 파일 SHA-256의 앞 12자리.
 * 앱은 자기가 가진(또는 원격에 올린) 번들로 같은 값을 계산해, 떠 있는 데몬이 예전 번들인지 가린다 (설계 §3.4).
 * 버전 번호만으로는 개발 중 다시 빌드한 번들을 구별하지 못하기 때문이다.
 * 번들 없이 실행하거나 파일을 읽지 못하면 undefined.
 */
export function agentBuildOf(script: string | undefined): string | undefined {
  if (AGENT_VERSION === "dev" || !script) return undefined;
  try {
    return createHash("sha256").update(readFileSync(script)).digest("hex").slice(0, 12);
  } catch {
    return undefined;
  }
}
