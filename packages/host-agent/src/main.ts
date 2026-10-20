/**
 * Host Agent 실행 진입점.
 *
 *   node host-agent.mjs daemon   상주 데몬으로 실행 (보통 connect가 대신 띄움)
 *   node host-agent.mjs connect  표준 입출력 ↔ 데몬 소켓 중계 (앱·SSH가 실행)
 *   node host-agent.mjs version  버전 출력 (원격 배포 시 버전 확인용)
 */
import { runConnect } from "./connect";
import { AgentDaemon } from "./daemon";
import { AGENT_VERSION } from "./version";

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  switch (command) {
    case "daemon": {
      const daemon = new AgentDaemon();
      const listening = await daemon.listen();
      // 이미 다른 데몬이 떠 있으면 조용히 끝낸다.
      if (!listening) return 0;
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => void daemon.shutdown(signal));
      }
      return new Promise<number>(() => {}); // 데몬은 shutdown()에서 프로세스를 끝낸다.
    }
    case "connect":
      await runConnect();
      return 0;
    case "version":
      process.stdout.write(`${AGENT_VERSION}\n`);
      return 0;
    default:
      process.stderr.write("사용법: host-agent <daemon|connect|version>\n");
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[host-agent] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
