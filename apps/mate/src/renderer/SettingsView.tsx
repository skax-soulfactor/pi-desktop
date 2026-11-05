import { useEffect, useState } from "react";
import type { AutostartView, McpServerView, Overview, PiSetupView } from "../shared/api";
import { ModelSelect } from "./PiSetup";
import type { Act } from "./App";
import { relativeTime } from "./mate-view";
import { GrantChips } from "./GrantChips";
import { TunablesPanel } from "@pi-desktop/tunables-ui";
import { isWebClient } from "./clipboard-images";
import { setStopPreviousRunner, stopPreviousRunner } from "./HostPicker";

/**
 * Mate 설정과 실행기 상태. 셸이 하나로 갖는 것은 여기 두지 않는다 (설계 DESIGN-ONE-APP.md §7):
 * - 호스트는 머리 맨 앞에서 고르고, SSH 호스트는 Pi 작업 공간의 "SSH 호스트 관리"에서 더한다
 * - Pi 설치·로그인·프로바이더·모델, 업데이트, 프롬프트와 수치는 Pi 관리에서 한다 (수치 탭에 Mate 항목도 함께 보인다)
 * 휴대폰 웹은 Pi Web의 수치 탭이 작업 공간 항목을 모으지 않아(작업 공간 서버가 따로 돈다), 웹에서만 Mate 수치를 여기서 보인다.
 */
export function SettingsView({ overview, act, setup }: { overview: Overview; act: Act; setup: PiSetupView | undefined }) {
  const web = isWebClient();
  const [stopPrevious, setStopPrevious] = useState(stopPreviousRunner);
  const { config, runner } = overview;
  const [model, setModel] = useState(config.model);
  const [limit, setLimit] = useState(String(config.dailyRunLimit));
  const [maxCost, setMaxCost] = useState(String(config.maxCostUsd));
  const [autostart, setAutostartState] = useState<AutostartView>();
  const [servers, setServers] = useState<McpServerView[]>([]);
  useEffect(() => {
    void window.mate.getAutostart().then(setAutostartState);
    void window.mate.listMcp().then(setServers, () => setServers([]));
  }, []);
  const chatServers = new Set(config.chatMcpServers);
  useEffect(() => {
    setModel(config.model);
    setLimit(String(config.dailyRunLimit));
    setMaxCost(String(config.maxCostUsd));
  }, [config.model, config.dailyRunLimit, config.maxCostUsd]);
  const dirty = model.trim() !== config.model || Number(limit) !== config.dailyRunLimit || Number(maxCost) !== config.maxCostUsd;

  return (
    <section className="form">
      <div className="muted small-text">
        호스트는 머리 맨 앞에서 고릅니다. Pi 설치·로그인·모델{web ? "" : ", 프롬프트와 수치, 업데이트"}는 Pi 관리에서 합니다.{" "}
        <button className="small" onClick={() => void act(() => window.mate.openPiManager())}>
          Pi 관리 열기
        </button>
      </div>

      <h2>실행</h2>
      <label className="radio">
        <input type="checkbox" checked={config.paused} onChange={() => void act(() => window.mate.saveConfig({ paused: !config.paused }))} />
        <strong>일시 정지</strong> <span className="muted">시간표·변화 감지 실행을 멈춥니다. "지금 실행"은 그대로 됩니다.</span>
      </label>
      <label className="radio">
        <input type="checkbox" checked={config.desktopNotify} onChange={() => void act(() => window.mate.saveConfig({ desktopNotify: !config.desktopNotify }))} />
        <strong>PC 알림</strong> <span className="muted">창을 보고 있지 않을 때 대화 답·질문(승인 요청)·임무 결과·새 제안을 OS 알림으로 띄웁니다.</span>
      </label>
      <label>
        기본 모델
        <ModelSelect
          value={model}
          onChange={setModel}
          setup={setup}
          inheritLabel={`Pi 기본 모델 따르기${setup?.piDefaultModel ? ` (지금: ${setup.piDefaultModel})` : ""}`}
        />
        <span className="muted small-text">
          임무에서 따로 정하지 않으면 이 모델을 씁니다. "Pi 기본 모델 따르기"를 고르면 Pi 관리에서 바꾼 기본 모델을 그대로 씁니다. 목록은
          로그인한 프로바이더의 모델({setup?.models.length ?? "…"}개)입니다.
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
          disabled={!dirty || !(Number(limit) >= 0) || !(Number(maxCost) >= 0)}
          onClick={() =>
            void act(() =>
              window.mate.saveConfig({ model: model.trim(), dailyRunLimit: Math.floor(Number(limit)), maxCostUsd: Number(maxCost) }),
            )
          }
        >
          저장
        </button>
      </div>

      <h2>대화에서 쓸 MCP 서버</h2>
      <div className="row">
        {servers.length === 0 && <span className="muted small-text">MCP 서버가 없습니다 (스킬·MCP 탭에서 넣습니다)</span>}
        {servers.map((s) => (
          <label key={s.name} className="day" title={s.description ?? s.target}>
            <input
              type="checkbox"
              checked={chatServers.has(s.name)}
              onChange={() => {
                const next = new Set(chatServers);
                if (next.has(s.name)) next.delete(s.name);
                else next.add(s.name);
                void act(() => window.mate.saveConfig({ chatMcpServers: [...next] }));
              }}
            />{" "}
            {s.name}
          </label>
        ))}
      </div>
      {config.chatGrants.length > 0 && (
        <GrantChips
          label="대화에서 허용한 도구"
          grants={config.chatGrants}
          onRemove={(g) => void act(() => window.mate.saveConfig({ chatGrants: config.chatGrants.filter((x) => x !== g) }))}
        />
      )}
      <div className="muted small-text">처음 쓰는 도구는 대화 중에 Mate가 허용을 묻습니다. 허용한 도구만 다음부터 씁니다.</div>

      {web && (
        <TunablesPanel
          load={async () => {
            const [runner, local] = await Promise.all([window.mate.tunablesList(), window.mate.appTunablesList()]);
            return [...runner, ...local];
          }}
          save={(id, value) => (id.startsWith("app.") ? window.mate.appTunableSet(id, value) : window.mate.tunableSet(id, value))}
          onError={(message) => void act(() => Promise.reject(new Error(message)))}
          file={`${overview.home}/tunables.json (실행기), 웹 서버 데이터 폴더(~/.pi-web/mate)의 app-tunables.json (앱)`}
          applyNote="실행기가 다음 실행·대화부터 바로 읽습니다. 실행기를 다시 시작할 필요가 없습니다."
        />
      )}

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
      <label className="radio">
        <input
          type="checkbox"
          checked={stopPrevious}
          onChange={(e) => {
            setStopPrevious(e.target.checked);
            setStopPreviousRunner(e.target.checked);
          }}
        />
        <strong>호스트를 바꿀 때 지금 호스트의 실행기 멈추기</strong>
        <span className="muted">그대로 두면 앞 호스트의 임무도 계속 돕니다 (두 곳에서 같은 임무가 돌 수 있습니다)</span>
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
