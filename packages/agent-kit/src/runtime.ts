/**
 * 지금 Pi 프로세스가 어떤 실행인지. 확장들이 함께 쓴다 (설계 DESIGN-AGENT.md §1 "사람이 없으면 안전한 쪽으로").
 *
 * 확장은 대상 호스트의 Pi가 jiti로 불러오므로 이 파일은 다른 모듈을 import하지 않는다.
 */

/** 워커·예약 실행이 자식 Pi에 주는 환경 변수 */
export const WORKER_ENV = "PI_DESKTOP_AGENT_WORKER";
export const UNATTENDED_ENV = "PI_DESKTOP_AGENT_UNATTENDED";

/**
 * 사람이 지켜보고 있어 물을 수 있는가. RPC 모드는 hasUI가 늘 true라서, 아무도 답하지 않는
 * 워커·예약 실행은 환경 변수로 따로 알린다. 묻지 못하면 승인이 필요한 일은 거부해야 한다.
 */
export function attended(hasUI: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasUI && env[UNATTENDED_ENV] !== "1";
}

/** 다른 세션이 맡긴 일을 하는 워커인가. 워커는 다시 일을 맡기지 않는다 */
export function isWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WORKER_ENV] === "1";
}
