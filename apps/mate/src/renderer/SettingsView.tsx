import { useEffect, useState } from "react";
import type { Overview } from "../shared/api";
import type { Act } from "./App";
import { relativeTime } from "./mate-view";

/** Mate 전체 설정과 실행기 상태 */
export function SettingsView({ overview, act }: { overview: Overview; act: Act }) {
  const { config, runner } = overview;
  const [model, setModel] = useState(config.model);
  const [limit, setLimit] = useState(String(config.dailyRunLimit));
  useEffect(() => {
    setModel(config.model);
    setLimit(String(config.dailyRunLimit));
  }, [config.model, config.dailyRunLimit]);
  const dirty = model.trim() !== config.model || Number(limit) !== config.dailyRunLimit;

  return (
    <section className="form">
      <h2>실행</h2>
      <label className="radio">
        <input type="checkbox" checked={config.paused} onChange={() => void act(() => window.mate.saveConfig({ paused: !config.paused }))} />
        <strong>일시 정지</strong> <span className="muted">시간표 실행을 멈춥니다. "지금 실행"은 그대로 됩니다.</span>
      </label>
      <label>
        기본 모델
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider/model-id" />
        <span className="muted small-text">임무에서 따로 정하지 않으면 이 모델을 씁니다. Pi에 로그인된 프로바이더여야 합니다.</span>
      </label>
      <label>
        하루 시간표 실행 상한 (모든 임무 합계)
        <input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </label>
      <div className="row end">
        <button
          className="primary"
          disabled={!dirty || !model.trim() || !(Number(limit) >= 0)}
          onClick={() => void act(() => window.mate.saveConfig({ model: model.trim(), dailyRunLimit: Math.floor(Number(limit)) }))}
        >
          저장
        </button>
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
      <div className="row">
        <button onClick={() => void act(() => window.mate.restartRunner())}>실행기 다시 시작</button>
        <button onClick={() => void act(() => window.mate.revealHome())}>데이터 폴더 열기</button>
      </div>
      <p className="muted small-text">
        실행기는 앱을 닫아도 남아 시간표를 지킵니다. PC를 다시 켠 뒤에는 앱을 한 번 열어야 다시 돕니다. 승인이 필요한 일과 결과는 모두
        인박스에 쌓여, 앱을 켰을 때 봅니다.
      </p>
    </section>
  );
}
