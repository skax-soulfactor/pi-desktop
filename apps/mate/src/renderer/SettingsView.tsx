import { useEffect, useState } from "react";
import type { AutostartView, Overview, PiSetupView } from "../shared/api";
import { ModelOptions } from "./PiSetup";
import type { Act } from "./App";
import { relativeTime } from "./mate-view";

/** Mate 전체 설정과 실행기 상태 */
export function SettingsView({
  overview,
  act,
  setup,
  onRefreshSetup,
}: {
  overview: Overview;
  act: Act;
  setup: PiSetupView | undefined;
  onRefreshSetup: () => void;
}) {
  const { config, runner } = overview;
  const [model, setModel] = useState(config.model);
  const [limit, setLimit] = useState(String(config.dailyRunLimit));
  const [maxCost, setMaxCost] = useState(String(config.maxCostUsd));
  const [autostart, setAutostartState] = useState<AutostartView>();
  useEffect(() => {
    void window.mate.getAutostart().then(setAutostartState);
  }, []);
  useEffect(() => {
    setModel(config.model);
    setLimit(String(config.dailyRunLimit));
    setMaxCost(String(config.maxCostUsd));
  }, [config.model, config.dailyRunLimit, config.maxCostUsd]);
  const dirty = model.trim() !== config.model || Number(limit) !== config.dailyRunLimit || Number(maxCost) !== config.maxCostUsd;

  return (
    <section className="form">
      <h2>실행</h2>
      <label className="radio">
        <input type="checkbox" checked={config.paused} onChange={() => void act(() => window.mate.saveConfig({ paused: !config.paused }))} />
        <strong>일시 정지</strong> <span className="muted">시간표·변화 감지 실행을 멈춥니다. "지금 실행"은 그대로 됩니다.</span>
      </label>
      <label>
        기본 모델
        <input list="config-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider/model-id" />
        <ModelOptions id="config-models" setup={setup} />
        <span className="muted small-text">
          임무에서 따로 정하지 않으면 이 모델을 씁니다. 칸을 누르면 Pi에서 쓸 수 있는 모델({setup?.models.length ?? "…"}개)이 나옵니다.
          {setup?.piDefaultModel && (
            <>
              {" "}
              Pi 기본 모델: <button className="link" onClick={() => setModel(setup.piDefaultModel!)}>{setup.piDefaultModel}</button>
            </>
          )}
        </span>
      </label>
      <label>
        하루 자동 실행 상한 (시간표·변화 감지, 모든 임무 합계)
        <input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </label>
      <label>
        실행당 비용 상한 (USD)
        <input type="number" min={0} step={0.05} value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
        <span className="muted small-text">한 실행이 이 비용을 넘으면 멈춥니다. 0이면 상한 없음. 임무마다 따로 정할 수 있습니다.</span>
      </label>
      <div className="row end">
        <button
          className="primary"
          disabled={!dirty || !model.trim() || !(Number(limit) >= 0) || !(Number(maxCost) >= 0)}
          onClick={() =>
            void act(() =>
              window.mate.saveConfig({ model: model.trim(), dailyRunLimit: Math.floor(Number(limit)), maxCostUsd: Number(maxCost) }),
            )
          }
        >
          저장
        </button>
      </div>

      <h2>Pi</h2>
      <div className="kv">
        <span>Pi</span>
        <span>{setup ? (setup.pi ? `${setup.pi.version} (${setup.pi.source})` : "없음") : "확인 중…"}</span>
        <span>로그인</span>
        <span>{setup ? setup.authProviders.join(", ") || "없음 (환경 변수·models.json으로 쓰는 프로바이더는 모델 수에 들어감)" : "…"}</span>
        <span>쓸 수 있는 모델</span>
        <span>{setup ? `${setup.models.length}개` : "…"}</span>
        <span>Pi Desktop</span>
        <span className="path">{setup?.piDesktopPath ?? "찾지 못함 (기본 위치)"}</span>
      </div>
      <div className="row">
        <button onClick={onRefreshSetup}>다시 확인</button>
        {setup?.piDesktopPath ? (
          <button onClick={() => void act(() => window.mate.openPiDesktop())}>Pi Desktop 열기 (Pi 설치·로그인·모델 관리)</button>
        ) : (
          <button onClick={() => void act(() => window.mate.installPiDesktop())}>Pi Desktop 설치</button>
        )}
      </div>

      <h2>실행기</h2>
      <div className="kv">
        <span>상태</span>
        <span>{runner.alive ? `동작 중 (pid ${runner.pid})` : "꺼짐"}</span>
        <span>마지막 확인</span>
        <span>{runner.heartbeatAt ? relativeTime(runner.heartbeatAt, Date.now()) : "-"}</span>
        <span>데이터 폴더</span>
        <span className="path">{overview.home}</span>
      </div>
      <label className="radio">
        <input
          type="checkbox"
          disabled={!autostart?.supported}
          checked={autostart?.enabled ?? false}
          onChange={() => void act(async () => setAutostartState(await window.mate.setAutostart(!autostart?.enabled)))}
        />
        <strong>로그인할 때 실행기 시작</strong>
        <span className="muted">{autostart?.reason ?? "PC를 켜고 앱을 열지 않아도 시간표·변화 감지가 돕니다 (창은 뜨지 않음)"}</span>
      </label>
      <div className="row">
        <button onClick={() => void act(() => window.mate.restartRunner())}>실행기 다시 시작</button>
        <button onClick={() => void act(() => window.mate.revealHome())}>데이터 폴더 열기</button>
      </div>
      <p className="muted small-text">
        실행기는 앱을 닫아도 남아 시간표를 지킵니다. 결과와 승인이 필요한 변경은 모두 인박스에 쌓여, 앱을 켰을 때 봅니다.
      </p>
    </section>
  );
}
