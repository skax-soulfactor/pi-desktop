import { piSetupIssues, type PiSetupView } from "../shared/pi-setup";
import { KeysPanel } from "./KeysPanel";
import { PiDesktopButton } from "./PiSetupBanner";

/**
 * 설정 (설계 DESIGN-AGENT.md §0 "Pi 관리").
 * Pi 설치·로그인·프로바이더·모델 같은 Pi 관리는 Pi Desktop에서 한다. 여기서는 상태를 보여 주고 Pi Desktop으로 보낸다.
 * API 키를 OS 키체인에 두고 싶을 때만 아래 "API 키"를 쓴다.
 */
export function SettingsPage({ setup, onRefresh, onError }: { setup?: PiSetupView; onRefresh: () => void; onError: (message: string) => void }) {
  const issues = setup ? piSetupIssues(setup) : [];
  return (
    <div className="page">
      <header className="page-head">
        <h2>설정</h2>
      </header>
      <div className="page-body">
        <section className="card">
          <h3>Pi</h3>
          <p className="muted">
            Pi 설치·업데이트·로그인과 <strong>프로바이더·모델 관리는 Pi Desktop</strong>에서 합니다. 여기서 바꾼 대화 모델은 그 대화에만 적용됩니다.
          </p>
          {setup ? (
            <dl className="facts">
              <dt>Pi</dt>
              <dd>{setup.piVersion ? `설치됨 (${setup.piVersion})` : `없음${setup.piError ? ` — ${setup.piError}` : ""}`}</dd>
              <dt>Node.js</dt>
              <dd>
                {setup.node.version ?? "알 수 없음"} {setup.node.ok ? "" : `(필요: ${setup.node.required ?? "22.19 이상"})`}
              </dd>
              <dt>로그인한 프로바이더</dt>
              <dd>{setup.authProviders.length > 0 ? setup.authProviders.join(", ") : "없음"}</dd>
              <dt>쓸 수 있는 모델</dt>
              <dd>{setup.models.length > 0 ? `${setup.models.length}개` : "없음"}</dd>
              {setup.platform === "win32" && setup.gitBash && (
                <>
                  <dt>Git Bash</dt>
                  <dd>{setup.gitBash.found ? "있음" : "없음 (명령 실행에 필요)"}</dd>
                </>
              )}
              <dt>Pi Desktop</dt>
              <dd>{setup.piDesktopPath ? "설치됨" : "설치되지 않음"}</dd>
            </dl>
          ) : (
            <p className="muted">Pi 상태를 읽는 중…</p>
          )}
          <div className="row">
            {setup && <PiDesktopButton setup={setup} onError={onError} />}
            <button className="small" onClick={onRefresh}>
              다시 확인
            </button>
            {issues.length === 0 && setup && <span className="badge ok">준비됨</span>}
          </div>
        </section>

        <section className="card">
          <h3>API 키 (선택)</h3>
          <KeysPanel onError={onError} />
        </section>
      </div>
    </div>
  );
}
