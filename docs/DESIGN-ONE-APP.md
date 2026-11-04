# 세 앱을 하나로 — 설계 문서 (초안 v0.1)

> 관련 문서: [세 앱의 역할과 데이터 경계](DESIGN-APPS.md), [Pi Desktop 설계](DESIGN.md), [Agent 설계](DESIGN-AGENT.md), [Mate 설계](DESIGN-MATE.md), [Mate 원격 실행기](DESIGN-MATE-REMOTE.md)
>
> 상태: **0.7.0에서 합쳤다** (2026-11-04). §0의 결정대로 P1~P5를 마쳤다. 미룬 것은 §10 각 단계에 적었다.

Pi Desktop·Agent·Mate를 **설치본 하나(Pi Desktop)** 로 합치고, Agent와 Mate는 그 안의 **내장 플러그인(작업 공간)** 으로 둔다.
데이터는 지금처럼 앱마다 나눈 채로 두고, 창·설치·업데이트·호스트 연결·설정 화면만 하나로 만든다.

---

## 0. 결정 (2026-11-04 확정, 모두 제안대로)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 합친 앱의 버전 | **0.7.0** (마이너). 설치본 구성이 바뀌므로 패치로 내지 않는다 |
| D2 | 합친 앱의 이름·설치 폴더 | **Pi Desktop** 그대로 (appId `dev.pi-desktop.app`, 업데이트 채널 `latest*.yml`). 기존 Pi Desktop 설치본이 그대로 업데이트된다 |
| D3 | 기존 Agent·Mate 설치본 | 마지막 업데이트(징검다리 0.7.0)가 "Pi Desktop으로 합쳐졌습니다"를 보이고 Pi Desktop을 열거나 설치하게 한다. **스스로 지우지는 않는다** (제거는 사용자가 Windows 설정에서) |
| D4 | Agent·Mate를 따로 띄우던 습관 | 한 창 안에서 작업 공간을 바꾸는 것이 기본. 원하면 **작업 공간을 새 창으로 열기**를 둔다 (P5, 필요할 때) |
| D5 | 바깥 플러그인(내려받아 끼우기) | **이번에는 하지 않는다.** 내장 플러그인만. 계약(§5)은 바깥 플러그인으로 넓힐 수 있게 잡아 둔다 |

---

## 1. 배경

### 1.1 지금 구조

| | Pi Desktop | Agent | Mate |
|---|---|---|---|
| 하는 일 | Pi를 GUI로 쓴다 (Pi 설치·로그인·모델 관리 포함) | 기억·승인·스킬·작업을 얹은 개인 에이전트 | 임무를 돌리고 작업을 관찰해 제안하는 비서 |
| 데이터 홈 | `~/.pi-desktop` (+ Pi 기본 폴더) | `~/.pi-desktop-agent` | `~/.pi-desktop-mate` |
| 백그라운드 | Host Agent 데몬 (홈 `~/.pi-desktop`) | Host Agent 데몬 (홈 `~/.pi-desktop-agent`) + 스케줄러 세션 | mate-runner 실행기 |
| 호스트 | 여러 호스트를 탭으로 | 한 번에 한 호스트 | 한 번에 한 호스트 |
| 코드 (대략) | main 3.3천, 화면 18천 줄 | main 1.6천, 화면 4.6천, `vendor/` 2.7천 (Pi Desktop 복사본) | main 1.6천, 화면 3.8천 |

Agent·Mate는 **Pi 설치본과 로그인 정보만 있으면** Pi Desktop 없이도 돈다. 하지만 Pi 설치·업데이트·로그인·모델 관리는 Pi Desktop에만 있어, 실제로는 Pi Desktop과 함께 쓴다.

### 1.2 세 벌이라서 드는 비용

0.6.0부터 세 앱은 같은 버전, 0.6.4부터 한 릴리스로 나간다. "따로 내기"의 이점은 이미 쓰지 않는데 "따로 설치하기"의 비용은 그대로다.

| 세 벌인 것 | 실제로 겪은 일 |
|---|---|
| 설치 프로그램 | Pi Desktop 설치가 Agent·Mate를 껐다 (설치 폴더 이름이 앞부분이 같아서, #181) |
| 자동 업데이트·채널 | 업데이트 순서에 따라 데몬 버전·안내가 다르게 보였다. 징검다리 릴리스(`agent-v0.6.4`·`mate-v0.6.4`)가 필요했다 |
| 호스트 연결 | Agent `vendor/`가 Pi Desktop 연결 코드의 복사본이라 따로 고쳐야 하고, 설정 꺼내기(§7)에서도 빠졌다 |
| 설정 화면 | 같은 "프롬프트와 수치"를 세 앱에 따로 붙였다 |
| 휴대폰 웹 | 서버·화면 묶음이 세 개 |
| 데몬 | 같은 호스트에 Host Agent 데몬이 둘 (Pi Desktop·Agent) |

---

## 2. 목표와 하지 않는 것

**목표**
- 설치·업데이트·자동 시작이 하나다. 업데이트 순서를 신경 쓰지 않는다.
- 호스트 연결·Pi 관리·설정·알림·휴대폰 웹이 한 벌이다. `vendor/` 복사본이 없어진다.
- Agent·Mate의 화면과 동작은 그대로다 (사용자가 다시 배울 것이 없다).
- 새 기능을 붙이는 틀(플러그인 계약)이 생긴다.

**하지 않는 것**
- 데이터 합치기. 세 홈과 그 안의 형식은 그대로다 (§4).
- 데몬·실행기 합치기. 백그라운드 프로세스의 수와 역할은 그대로다 (§4.2). 나중에 따로 검토한다 (§11).
- 바깥 플러그인 내려받기·마켓 (D5).
- Agent·Mate 기능 바꾸기. 옮기기만 한다.

---

## 3. 모습

```
Pi Desktop (설치본 하나, 창 하나)
├─ 셸: 호스트 고르기 · Pi 관리 · 업데이트 · 알림 · 공통 설정 · 휴대폰 웹 서버
├─ 작업 공간 "Pi"     = 지금의 Pi Desktop 화면      → 데몬 (홈 ~/.pi-desktop)
├─ 작업 공간 "Agent"  = 지금의 Agent 화면 (플러그인) → 데몬 (홈 ~/.pi-desktop-agent) + 스케줄러 세션
└─ 작업 공간 "Mate"   = 지금의 Mate 화면 (플러그인)  → mate-runner (홈 ~/.pi-desktop-mate)
```

- 창 맨 왼쪽에 **작업 공간 막대**(Pi / Agent / Mate 아이콘)를 둔다. 누르면 그 작업 공간의 화면으로 바뀐다. 각 작업 공간 안의 사이드바·탭은 지금 그대로다.
- 작업 공간을 바꿔도 다른 작업 공간의 대화·실행은 끊기지 않는다 (화면만 바뀐다).
- 알림(승인 요청, 임무 결과 등)은 셸이 모아 보인다. 누르면 그 작업 공간으로 간다.
- 쓰지 않는 작업 공간은 설정에서 끌 수 있다. 끄면 막대에서 사라지고 그 백그라운드도 띄우지 않는다.

---

## 4. 지키는 것

### 4.1 데이터 경계 (DESIGN-APPS.md §2·§3 그대로)
- 세 홈(`~/.pi-desktop`, `~/.pi-desktop-agent`, `~/.pi-desktop-mate`)과 그 안의 파일은 **옮기지도, 합치지도 않는다**. 그래서 데이터 이전이 없다.
- 플러그인은 자기 홈만 쓴다. 다른 플러그인의 홈은 읽지 않는다 (Mate의 활동 관찰처럼 설계로 정한 읽기만 예외).
- Pi 자체(설치본·로그인·모델·신뢰)는 지금처럼 함께 쓰고, 관리는 셸의 Pi 관리가 맡는다.

### 4.2 백그라운드 프로세스
| 프로세스 | 그대로 둘 것 |
|---|---|
| Host Agent 데몬 (Pi 작업 공간) | 홈 `~/.pi-desktop`. 앱을 닫아도 돈다 |
| Host Agent 데몬 (Agent 작업 공간) | 홈 `~/.pi-desktop-agent`. **데몬을 하나로 합치지 않는다** — 데몬이 홈 하나를 전제로 짜여 있고(세션 폴더·휴지통·`agent.call`), 합치면 데이터 경계가 코드 안으로 들어온다 |
| 스케줄러 세션 | Agent 작업 공간이 켜져 있으면 지금처럼 띄운다 |
| mate-runner | 홈 `~/.pi-desktop-mate`. 앱을 닫아도 돈다. 로그인할 때 시작(`--mate-runner-only`)도 그대로 — 실행 파일만 Pi Desktop이 된다 |

같은 호스트에 데몬이 둘인 것은 그대로지만, **같은 번들**이라 업데이트가 한 번에 맞춰진다 (지금 겪는 "한쪽만 업데이트 대기"가 줄어든다).

---

## 5. 플러그인 계약 (내장)

플러그인은 저장소 안의 패키지이고 셸과 함께 빌드된다. 셸은 아래 모양만 안다.

**화면은 iframe으로 띄운다 (P1에서 정함).** 처음에는 플러그인 화면을 셸 화면 안의 React 컴포넌트로 넣으려 했지만,
세 앱의 CSS가 같은 선택자(`.page`, `.card`, `.modal` …)를 서로 다르게 쓰고 Agent는 Pi Desktop CSS의 복사본까지 가지고 있어
묶음 하나로 합치면 화면이 서로 깨진다. 그래서 **플러그인 화면은 그 앱의 화면 빌드를 그대로 셸 창 안의 iframe으로 연다.**
- CSS·화면 코드가 섞이지 않고, 한 작업 공간이 멈춰도 다른 작업 공간은 그대로다 (§11의 오류 경계가 따로 필요 없다).
- preload는 창 하나에 하나지만 모든 프레임에서 돈다(`nodeIntegrationInSubFrames`). 프레임 주소로 그 화면의 API만 만든다
  (맨 위 프레임 `window.piDesktop`, `out/renderer/agent/` 프레임 `window.piAgent`, 그 밖의 프레임은 아무것도 없음).
- main이 플러그인 화면에 보내는 알림은 그 프레임으로만 간다 (`WebFrameMain.send`).
- 메뉴바: 플러그인 작업 공간을 보는 동안은 그 앱의 메뉴바(Agent는 기능 화면을 메뉴바에서 연다)에 "작업 공간" 메뉴를 더해 쓴다.

아래 계약에서 `renderer.Workspace`는 "화면 빌드 경로"로 읽는다.

```ts
interface PiDesktopPlugin {
  id: "agent" | "mate" | string;          // 저장 키·IPC 접두. 바꾸지 않는다
  name: string;                            // 막대·설정에 보일 이름
  icon: string;                            // 작업 공간 막대 아이콘
  home(hostHome: string): string;          // 그 호스트에서의 데이터 홈 (예: ~/.pi-desktop-agent)

  main: {
    /** 셸이 호스트에 붙을 때. 백그라운드(데몬·실행기)를 준비하고 연결을 돌려준다 */
    connect(host: HostContext): Promise<PluginConnection>;
    /** 이 플러그인의 IPC 처리기. 채널 이름은 `<id>:`로 시작해야 한다 */
    registerIpc(router: PluginRouter, conn: () => PluginConnection): void;
    /** 로그인할 때 할 일 (Mate: 실행기만 확인). 없으면 생략 */
    onLogin?(): Promise<void>;
    /** 업데이트 설치 직전 (Mate: 실행기를 멈춰 설치 파일을 놓게 한다) */
    beforeUpdate?(): Promise<void>;
  };

  renderer: {
    /** 작업 공간 화면 (지금 App.tsx의 내용) */
    Workspace: React.ComponentType<{ host: HostView }>;
    /** 셸 설정 화면에 붙는 칸 (없으면 생략) */
    Settings?: React.ComponentType;
    /** "프롬프트와 수치"에 합칠 항목 목록과 저장 (DESIGN-APPS.md §7) */
    tunables?: { load(): Promise<TunableItem[]>; save(id: string, value: number | string | null): Promise<TunableItem> };
    /** 셸 알림 모음에 올릴 것 (승인 요청·임무 결과 등) */
    notifications?: NotificationSource;
  };

  /** 휴대폰 웹에서도 쓸지, 웹 서버에 붙을 처리기 */
  web?: { registerServer(router: PluginRouter): void };
}
```

- **preload**: 창의 preload 하나가 프레임 주소로 그 앱의 API(`window.piAgent`·`window.mate`)를 만든다. 화면 코드는 고치지 않는다.
- **CSS**: 화면이 iframe이라 섞이지 않는다. 세 앱이 같은 색 변수 이름(`--border`, `--accent`…)을 써서 모양은 맞는다.
- **새 기능의 기본 모양**: 동작은 **Pi 확장(kit)** 으로 만들고 (터미널 `pi`에서도 돈다), 앱 플러그인은 그 화면만 맡는다. agent-kit·mate-kit이 이미 이 모양이다.
- 바깥 플러그인(D5)으로 넓힐 때 더할 것: 서명·권한 선언, 격리(별도 창·프로세스), 셸 API 버전.

---

## 6. 호스트와 연결

- **호스트 목록·SSH 설정·원격 배포는 셸이 하나로 갖는다** (지금 세 앱이 `ssh-hosts.json`을 따로 가짐 → 하나로).
- 작업 공간마다 "지금 호스트"가 있다. 기본은 셸에서 고른 호스트를 따르고, Agent·Mate는 지금처럼 한 번에 한 호스트다.
- 연결은 셸의 `HostManager`가 **(호스트, 홈)** 쌍마다 하나씩 관리한다. Pi 작업 공간은 `(호스트, ~/.pi-desktop)`, Agent는 `(호스트, ~/.pi-desktop-agent)` 데몬에 붙는다. Mate는 실행기 연결(`RunnerConnection`)을 그대로 쓰되 원격 배포는 셸의 `host-deploy`를 쓴다.
- 결과: Agent의 `vendor/main`(host-connection·reconnect-policy·agent-build 등)이 셸 코드로 바뀌어 **복사본이 없어진다**. 다시 연결·업데이트 대기·설정 수치가 세 작업 공간에서 같아진다.

---

## 7. 설정 화면

| 칸 | 내용 |
|---|---|
| 공통 | 호스트, 업데이트, 로그인할 때 시작, 작업 공간 켜기·끄기, 알림 |
| Pi 관리 | 지금 Pi Desktop의 Pi 관리 (설치·로그인·모델·설정·비교) — Agent·Mate의 "Pi Desktop에서 하세요" 안내가 없어진다 |
| 프롬프트와 수치 | 한 목록에 앱·데몬·Agent·Mate·툴 설명을 모두. 거르기에 "작업 공간" 추가 |
| 작업 공간별 | 플러그인의 `Settings` (Agent: 관리자 권한 실행 등, Mate: 실행·모델·휴대폰 연결 등) |

---

## 8. 설치·업데이트·자동 시작

- 설치본은 Pi Desktop 하나 (D2). Windows·macOS·Linux 설치 파일과 웹 묶음 하나씩.
- 업데이트 채널은 `latest*.yml` 하나. `agent*.yml`·`mate*.yml`은 징검다리(§9)까지만 낸다.
- 업데이트 직전에 셸이 각 플러그인의 `beforeUpdate`를 부른다 (Mate 실행기 멈춤 등).
- 로그인할 때 시작: 셸이 켜진 플러그인의 `onLogin`을 부른다 (창은 띄우지 않음). Mate 실행기 자동 시작이 이 길로 바뀐다.

---

## 9. 옮겨 가기

**데이터 홈은 그대로**라 옮길 것은 각 앱 `userData`의 작은 파일뿐이다.

| 파일 (앱 userData) | 처리 |
|---|---|
| `ssh-hosts.json` (세 앱) | 셸 것에 이름이 없는 항목만 더한다 |
| `agent-host.json`, `mate-host.json` (지금 호스트) | 그 작업 공간의 지금 호스트로 |
| `app-tunables.json` (세 앱) | id가 겹치지 않게 `agent.app.*`·`mate.app.*`로 바꿔 합친다 |
| `window-state.json` | Pi Desktop 것만 쓴다 |
| 로그인 항목 (Mate 실행기) | 옛 Mate 항목을 지우고 Pi Desktop 항목으로 (Mate 작업 공간이 켜져 있을 때) |

처음 실행할 때 한 번 옮기고 `migrated-from.json`에 적어 다시 하지 않는다. 옛 앱 폴더의 파일은 지우지 않는다.

**징검다리 릴리스 (0.7.0)**
- Pi Desktop 0.7.0: 합친 앱. 위 이전을 한다.
- Agent·Mate 0.7.0 (마지막): 화면 대신 "Pi Desktop으로 합쳐졌습니다" 한 장. Pi Desktop이 있으면 열고 스스로 끝나고, 없으면 설치 페이지를 연다. 자동 시작 항목을 지운다. 업데이트 확인은 끈다.
- 이 릴리스 뒤로는 `agent*.yml`·`mate*.yml`을 올리지 않는다. 옛 설치본은 0.7.0에서 멈춘다.

---

## 10. 단계

각 단계는 PR 하나 이상이고, 단계가 끝날 때마다 지금처럼 릴리스할 수 있는 상태를 지킨다. 합칠 때(P5)까지는 Agent·Mate 설치본도 계속 나가고, Pi Desktop의 플러그인 작업 공간은 **미리 보기(기본 꺼짐)** 다.

| 단계 | 내용 | 확인 |
|---|---|---|
| **P1 셸과 Agent 작업 공간 (미리 보기)** | Agent main을 창과 떼어 `createAgentMain(ctx)`로, preload API를 `createAgentApi`로 나눈다(단독 Agent 앱은 그대로). Pi Desktop에 작업 공간 막대·Agent 프레임·프레임별 preload·메뉴바 전환·"작업 공간" 메뉴. 빌드가 Agent 화면을 `out/renderer/agent/`에, 설치본이 agent-kit·pi-isolation을 리소스로 싣는다. 메뉴바 "작업 공간 → Agent 켜기"로 켠다 | Electron으로 띄워: 막대·Agent 프레임 API·Agent 데몬 연결·메뉴바 전환·Agent 메뉴 명령·"Pi Desktop 열기"→Pi 관리 |
| **P2 Mate 작업 공간 (미리 보기)** | Mate main을 `createMateMain(ctx)`로, preload API를 `createMateApi`로 나눈다(단독 Mate 앱은 창·단일 실행·로그인 시작·업데이트만). Pi Desktop에 Mate 프레임(`window.mate`)·Mate 메뉴바(편집·보기·작업 공간·도움말). 상태 파일은 `userData/mate/`, Mate 홈(`~/.pi-desktop-mate`)과 실행기는 단독 앱과 같다. 로그인 시작은 미리 보기에서 "단독 Mate 앱에서 켭니다"로 두고 0.7.0에서 옮긴다. Pi Desktop 업데이트 설치 직전에 이 PC의 실행기를 멈춘다. 설치본이 mate-runner·mate-kit을 리소스로 싣는다 | Electron으로 띄워: 프레임별 API 분리(mate·piAgent·piDesktop), 실행기 연결(alive), 메뉴바 전환, 로그인 시작 안내, Agent↔Mate 전환. Windows 업데이트 전 실행기 멈춤은 PC에서 |
| **P3 연결·설정·알림 합치기** | Agent `vendor/`를 Pi Desktop 연결 코드로 바꾼다 (HostManager가 홈별 연결). 설정 칸(§7), "프롬프트와 수치" 한 목록, 알림 모음, SSH 호스트 목록 하나 | Agent 테스트·실제 Pi 계약 테스트, 두 데몬이 한 호스트에서 함께 도는지 |
| **P4 휴대폰 웹 하나로** | 묶음은 이미 하나(`pi-web.tar.gz`). `pi-web start`(앱 이름 없이)가 세 서버를 함께 켜고 끈다(Agent·Mate 먼저). Pi Web 화면이 켜진 Agent·Mate 서버 주소(`$PI_WEB_HOME/agent·mate/url`)를 받아 **화면 아래 작업 공간 막대**와 iframe으로 연다 (다른 기기에서 열면 그 주소의 호스트로 바꾼다). 서버 프로세스는 셋 그대로 — 각 앱 웹 서버가 자기 토큰·WebSocket·푸시를 갖기 때문이다. 하나의 프로세스로 합치는 것은 각 앱 화면이 경로 접두(`/agent/`)를 받아야 해서 미룬다 | 웹 빌드, 360~412폭 휴대폰 화면에서 막대·Agent·Mate 프레임, 설치 스크립트 업데이트 때 켜져 있던 서버를 모두 다시 켬 |
| **P5 0.7.0 합치기** | 미리 보기 표시를 떼고 기본으로 켠다 (끈 것만 `workspaces.json`에 적는다). 처음 실행할 때 옛 Agent·Mate userData의 지금 호스트·앱 수치를 `userData/agent·mate/`로, SSH 호스트는 없는 이름만 더한다 (`migrate.ts`, `migrated-from.json`). Mate "로그인할 때 실행기 시작"을 Pi Desktop으로: 로그인 항목이 Pi Desktop을 `--mate-runner-only`로 띄워 창 없이 실행기만 확인한다. 업데이트 전 실행기 멈춤. 단독 Agent·Mate 앱은 **징검다리**만 남긴다: 열면 "Pi Desktop으로 합쳐졌습니다" → Pi Desktop 열기/내려받기, Mate는 자기 로그인 항목을 지우고 Pi Desktop이 이어받을 표시(`mate-autostart-wanted`)를 남긴다. 업데이트 확인 없음. 릴리스 워크플로는 v0.7.0에서만 Agent·Mate를 만든다. **미룬 것:** D4 작업 공간을 새 창으로 열기 (필요할 때) | 단위 테스트(이전), Electron으로 기본 켜짐·작업 공간 전환, 징검다리 빌드. 옛 0.6.x 설치본에서 0.7.0으로 올라오는지는 PC에서 |

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 앱 하나가 커져 시작이 느려진다 | 꺼진 작업 공간은 불러오지 않는다 (화면은 동적 import, 백그라운드는 켜진 것만) |
| 한 작업 공간의 오류가 창 전체를 멈춘다 | 작업 공간 화면이 iframe이라 서로 멈추지 않는다 (§5). 프레임만 다시 불러올 수 있다 |
| IPC 채널·CSS가 서로 부딪힌다 | 채널은 앱마다 접두가 다르다(`pi:`·`agent:`·`mate:`). CSS는 iframe이라 섞이지 않는다 |
| 옮겨 가다 사용자가 옛 앱과 새 앱을 함께 띄운다 | 데이터 홈이 같아도 데몬·실행기는 하나만 뜨게 이미 잠금이 있다. 옛 앱 0.7.0은 화면을 띄우지 않는다 |
| 데몬 둘을 하나로 합치고 싶어진다 | 이 문서 범위 밖. 데몬이 여러 홈을 받게 하려면 세션·휴지통·`agent.call`이 홈을 인자로 받아야 해서 따로 설계한다 |
| Windows·macOS 동작은 클라우드에서 확인할 수 없다 | 단계마다 릴리스 워크플로 "만들기만"(version 비움)으로 설치 파일까지 만들어 보고, PR에 "PC에서 확인 필요"를 남긴다 |

---

## 12. 하고 나면 바뀌는 문서

- `DESIGN-APPS.md`: §1 역할 표를 "작업 공간"으로, §4 실행 위치에 셸을 더한다. 데이터 경계(§2·§3)는 그대로.
- `CLAUDE.md`·`CONTRIBUTING.md`: 릴리스(설치본 하나, 채널 하나), 웹 묶음 하나, `apps/agent`·`apps/mate` 대신 `plugins/*`.
- `DESIGN-AGENT.md` §0 "Pi Desktop은 건드리지 않는다"와 `vendor/` 규칙을 지운다.
