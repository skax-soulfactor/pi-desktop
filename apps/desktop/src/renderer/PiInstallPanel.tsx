import { useEffect, useState } from "react";
import type { PiStatus } from "@pi-desktop/host-protocol/messages";
import {
  installSteps,
  stableVersionsNewestFirst,
  uninstallStep,
  versionInstallStep,
  type InstallStep,
} from "./pi-install-commands";

/**
 * Pi 관리 창의 설치·다른 버전·제거 영역 (설계 §4.9).
 * 앱이 명령을 몰래 실행하지 않는다: 실행할 명령을 그대로 보여주고, 확인하면 내장 터미널(셸)에 입력해 눈앞에서 돈다.
 * 데이터(~/.pi/agent)는 건드리지 않는다.
 */
export function PiInstallPanel({
  hostId,
  status,
  onRunInTerminal,
}: {
  hostId: string;
  status: PiStatus;
  onRunInTerminal: (command: string, title: string) => void;
}) {
  const [confirm, setConfirm] = useState<{ step: InstallStep; sessions: number } | undefined>();
  const [versions, setVersions] = useState<string[] | undefined>();
  const [versionsError, setVersionsError] = useState<string | undefined>();
  const [version, setVersion] = useState("");
  const source = status.pi?.source;

  useEffect(() => {
    setConfirm(undefined);
    setVersions(undefined);
    if (source !== "npm-global") return;
    void window.piDesktop
      .piVersions(hostId)
      .then((v) => {
        const list = stableVersionsNewestFirst(v.versions).filter((x) => x !== status.pi?.version);
        setVersions(list);
        setVersion(list[0] ?? "");
        setVersionsError(v.error);
      })
      .catch((e) => setVersionsError(String(e)));
  }, [hostId, source, status.pi?.version]);

  async function ask(step: InstallStep) {
    // Pi를 바꾸거나 지우는 단계는 실행 중인 세션을 알린다 (그 세션들은 지금 버전으로 계속 돈다).
    const changesPi = step.id === "version" || step.id === "uninstall";
    const sessions = changesPi
      ? (await window.piDesktop.listSessions(hostId).catch(() => [])).filter((s) => s.state === "running").length
      : 0;
    setConfirm({ step, sessions });
  }

  const steps: InstallStep[] = [];
  if (!status.pi) steps.push(...installSteps(status.platform, status.node.ok));
  const versionStep = status.pi && version ? versionInstallStep(status.platform, source, version) : undefined;
  const removeStep = status.pi ? uninstallStep(status.platform, source) : undefined;

  return (
    <section className="pi-install">
      <h3>{status.pi ? "다른 버전·제거" : "Pi 설치"}</h3>
      {steps.length > 0 && (
        <div className="install-steps">
          {steps.map((step) => (
            <button key={step.id} type="button" className={step.id === "install" ? "primary" : undefined} onClick={() => void ask(step)}>
              {step.label}
            </button>
          ))}
        </div>
      )}
      {status.pi && (
        <div className="install-steps">
          {source === "npm-global" ? (
            <>
              <select value={version} onChange={(e) => setVersion(e.target.value)} disabled={!versions?.length} aria-label="설치할 버전">
                {!versions && <option value="">버전 목록 읽는 중…</option>}
                {versions?.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!versionStep} onClick={() => versionStep && void ask(versionStep)}>
                이 버전 설치
              </button>
              {versionsError && <span className="muted">버전 목록을 읽지 못했습니다: {versionsError}</span>}
            </>
          ) : (
            <span className="muted">
              {source === "managed"
                ? "관리형 설치는 특정 버전을 고를 수 없습니다 (업데이트로 최신 버전을 받습니다)."
                : "이 설치는 앱이 버전을 바꾸거나 지울 수 없습니다 (환경 변수·직접 지정한 경로)."}
            </span>
          )}
          {removeStep && (
            <button type="button" className="danger" onClick={() => void ask(removeStep)}>
              {removeStep.label}
            </button>
          )}
        </div>
      )}
      {confirm && (
        <div className="install-confirm">
          <div>{confirm.step.note}</div>
          {confirm.sessions > 0 && (
            <div className="banner warn">
              실행 중인 세션 {confirm.sessions}개는 지금 버전으로 계속 돕니다. 새 버전을 쓰거나 완전히 지우려면 그 세션을 닫으세요.
            </div>
          )}
          <div className="muted">아래 명령을 터미널에서 실행합니다. 데이터(~/.pi/agent)는 그대로 남습니다.</div>
          <pre className="install-command">{confirm.step.command}</pre>
          <div className="install-steps">
            <button
              type="button"
              className={confirm.step.id === "uninstall" ? "danger" : "primary"}
              onClick={() => {
                const { step } = confirm;
                setConfirm(undefined);
                onRunInTerminal(step.command, step.label);
              }}
            >
              터미널에서 실행
            </button>
            <button type="button" onClick={() => setConfirm(undefined)}>
              취소
            </button>
          </div>
          <div className="muted">끝나면 이 창을 다시 열어 "다시 확인"을 누르세요.</div>
        </div>
      )}
    </section>
  );
}
