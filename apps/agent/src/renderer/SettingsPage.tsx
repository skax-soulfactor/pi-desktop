import { useEffect, useState } from "react";
import { TunablesPanel } from "@pi-desktop/tunables-ui";
import { isWebClient } from "./clipboard-images";

/**
 * Agent 설정. 셸이 하나로 갖는 것은 여기 두지 않는다 (설계 DESIGN-ONE-APP.md §7):
 * - 호스트는 사이드바 맨 위에서 고르고, SSH 호스트는 Pi 작업 공간의 "SSH 호스트 관리"에서 더한다
 * - Pi 설치·로그인·프로바이더·모델, 업데이트, 프롬프트와 수치는 Pi 관리에서 한다 (수치 탭에 Agent 항목도 함께 보인다)
 * 휴대폰 웹은 Pi Web의 수치 탭이 작업 공간 항목을 모으지 않아(작업 공간 서버가 따로 돈다), 웹에서만 Agent 수치를 여기서 보인다.
 */
export function SettingsPage({ onError }: { onError: (message: string) => void }) {
  const [elevation, setElevation] = useState<boolean>();
  useEffect(() => {
    window.piAgent.getElevation().then(setElevation, (error: unknown) => onError(String(error)));
  }, []);
  const web = isWebClient();
  return (
    <div className="page">
      <header className="page-head">
        <h2>설정</h2>
      </header>
      <div className="page-body">
        <p className="muted small-text">
          호스트는 옆 메뉴 맨 위에서 고릅니다. Pi 설치·로그인·모델{web ? "" : ", 프롬프트와 수치, 업데이트"}는 Pi 관리에서 합니다.{" "}
          <button className="small link-button" onClick={() => window.piAgent.openPiManager().catch((error: unknown) => onError(String(error)))}>
            Pi 관리 열기
          </button>
        </p>

        <section className="card">
          <h3>관리자 권한 실행</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={elevation ?? false}
              disabled={elevation === undefined}
              onChange={(e) => {
                const on = e.target.checked;
                window.piAgent.setElevation(on).then(
                  () => setElevation(on),
                  (error: unknown) => onError(String(error)),
                );
              }}
            />
            <span>에이전트가 관리자 권한이 필요한 작업을 요청할 수 있게 하기 (기본 꺼짐)</span>
          </label>
          <p className="muted small-text">
            켜면 사람이 지켜보는 대화에서만 shell_exec_elevated 도구가 보입니다. 부를 때마다 실행될 명령 그대로 승인을 받고(이번만 허용·거부),
            비밀번호는 OS 인증 창(Windows UAC 등)이 직접 받습니다. 예약·백그라운드 작업에서는 쓸 수 없습니다. 다음 요청부터 바로 적용됩니다.
          </p>
        </section>

        {web && (
          <TunablesPanel
            load={async () => {
              const [kit, daemon, local] = await Promise.all([
                window.piAgent.tunablesList(),
                window.piAgent.daemonTunablesList().catch((error: unknown) => {
                  onError(`데몬 수치를 읽지 못했습니다 (예전 데몬이면 다시 연결하면 됩니다): ${String(error)}`);
                  return [];
                }),
                window.piAgent.appTunablesList(),
              ]);
              return [...kit, ...daemon, ...local];
            }}
            save={(id, value) =>
              id.startsWith("daemon.")
                ? window.piAgent.daemonTunableSet(id, value)
                : id.startsWith("app.")
                  ? window.piAgent.appTunableSet(id, value)
                  : window.piAgent.tunableSet(id, value)
            }
            onError={onError}
            file="대화가 도는 호스트의 ~/.pi-desktop-agent/data/tunables.json(에이전트)·~/.pi-desktop-agent/tunables.json(데몬), 웹 서버 데이터 폴더(~/.pi-web/agent)의 app-tunables.json(앱)"
            applyNote="대부분 다음 요청부터 바로 반영됩니다. 도구 설명에 들어가는 값(웹 기본 글자 수, 예약 최소 간격)은 새 대화부터, 예약 확인 간격은 앱을 다시 켠 뒤부터 반영됩니다."
          />
        )}
      </div>
    </div>
  );
}
