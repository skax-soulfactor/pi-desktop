/**
 * 작업 기록의 모양. 앱의 렌더러도 타입으로 쓰므로 이 파일은 아무것도 import하지 않는다.
 */

export type TaskStatus = "running" | "done" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  title: string;
  instruction: string;
  /** delegate: 대화에서 맡김, schedule: 예약 실행 */
  origin: "delegate" | "schedule";
  status: TaskStatus;
  cwd: string;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  error?: string;
}
