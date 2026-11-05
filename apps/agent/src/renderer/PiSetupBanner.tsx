import { piSetupIssues, type PiSetupView } from "../shared/pi-setup";

/**
 * Pi 준비 안내. 문제가 없으면 아무것도 그리지 않는다.
 * Pi 설치·로그인·프로바이더·모델 관리는 Pi 작업 공간의 Pi 관리에서만 한다 (설계 DESIGN-ONE-APP.md §7). 여기서는 그리로 보낸다.
 */
export function PiSetupBanner({ setup, onRefresh, onError }: { setup: PiSetupView; onRefresh: () => void; onError: (message: string) => void }) {
  const issues = piSetupIssues(setup);
  if (issues.length === 0) return null;
  const openPiManager = () =>
    window.piAgent.openPiManager().catch((error: unknown) => onError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error)));
  return (
    <div className="setup-banner">
      {issues.map((issue) => (
        <div key={issue.kind} className={`setup-issue ${issue.level}`}>
          <strong>{issue.title}</strong>
          <span className="muted">{issue.detail}</span>
          {(issue.kind === "no-pi" || issue.kind === "no-models") && (
            <button className="small primary" onClick={openPiManager}>
              Pi 관리 열기
            </button>
          )}
          {issue.kind === "git-bash" && (
            <a href="https://git-scm.com/download/win" target="_blank" rel="noreferrer">
              Git for Windows 내려받기
            </a>
          )}
        </div>
      ))}
      <button className="small" onClick={onRefresh}>
        다시 확인
      </button>
    </div>
  );
}
