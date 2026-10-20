// 앱(데스크톱 main 프로세스)이 Host Agent 경로·소켓 규칙을 공유하기 위한 export.
export { agentHome, runDir, socketPath } from "./paths";
export { EventJournal, type JournalEntry, type ReplayResult } from "./journal";
export { AGENT_VERSION } from "./version";
