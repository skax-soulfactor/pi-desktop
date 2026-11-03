import { dataDir } from "../extensions/permissions/store";
import { AGENT_TUNABLES } from "./tunables-defs";
import { tunableStoreAt, type TunableStore } from "./tunables-store";

export { AGENT_TUNABLES, agentDefault } from "./tunables-defs";

/**
 * Agent 설정 파일 (`<Agent 데이터 폴더>/tunables.json`, 설계 DESIGN-APPS.md §7).
 * 사용자가 설정 화면의 "프롬프트와 수치"에서 바꾼 값만 들어간다. 정의는 tunables-defs.ts.
 *
 * 확장(Pi가 jiti로 불러옴)에서도 쓰므로 node 내장 모듈과 이 패키지 안의 파일 말고는 import하지 않는다.
 */
export function agentTunables(dir: string = dataDir()): TunableStore {
  return tunableStoreAt(dir, AGENT_TUNABLES);
}
