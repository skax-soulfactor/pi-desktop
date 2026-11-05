# Pi Desktop

[Pi coding agent](https://pi.dev)를 **포크하지 않고**, 설치된 `pi` 그대로 엔진으로 쓰는 데스크톱 앱입니다.
Pi를 업데이트하면 앱도 그대로 따라갑니다. 휴대폰 브라우저에서 쓰는 웹 버전(pi-web)도 같은 소스에서 나옵니다.

## 한 앱, 세 작업 공간

창 왼쪽 막대에서 작업 공간을 바꿉니다 (휴대폰 웹은 화면 아래 막대). 바꿔도 다른 작업 공간의 대화·실행은 끊기지 않습니다.

| 작업 공간 | 하는 일 | 설명서 | 설계 |
|---|---|---|---|
| **Pi** | 설치된 Pi를 GUI로 쓴다. 채팅, 여러 프로젝트 탭, 로컬·WSL·SSH 호스트, Pi 설치·로그인·모델 관리, 리소스·Marketplace | [apps/desktop](apps/desktop/README.md) | [DESIGN.md](docs/DESIGN.md) |
| **Agent** | Pi를 엔진으로 쓰는 개인 에이전트. 승인, 지식베이스, 스킬, 예약 작업, 다른 사람의 에이전트와 연결 | [apps/agent](apps/agent/README.md) | [DESIGN-AGENT.md](docs/DESIGN-AGENT.md) |
| **Mate** | 묻기 전에 먼저 살펴보고 알려 주는 능동형 코딩 동료. 임무 시간표, 인박스, 별도 작업 공간에서 고치기, 텔레그램 | [apps/mate](apps/mate/README.md) | [DESIGN-MATE.md](docs/DESIGN-MATE.md) |

- **켜고 끄기**: 메뉴바 "작업 공간" 또는 Pi 관리 → "작업 공간". 끈 작업 공간은 막대에서 사라지고 그 백그라운드(데몬 연결·실행기 연결)도 띄우지 않습니다.
- **새 창으로**: 메뉴바 "작업 공간 → Agent·Mate를 새 창으로 열기". 창 안의 작업 공간과 함께 쓸 수 있습니다.
- **알림**: 보지 않는 작업 공간에 알림이 오면 막대에 수가 뜹니다. OS 알림을 누르면 그 작업 공간과 그 대화(또는 작업·인박스)로 갑니다.
- **설정**: Pi 관리 → "수치"에서 세 작업 공간의 프롬프트와 수치를 한 목록으로 보고 고칩니다 ("작업 공간"으로 거르기). 각 작업 공간의 설정 화면에도 같은 값이 있습니다.
- **창이 좁으면** 세 작업 공간 모두 휴대폰 웹과 같은 모양이 됩니다 (옆 메뉴는 ☰ 서랍, 탭 줄은 옆으로 밀기). 옆 창 너비는 경계를 끌어 바꿉니다 (두 번 누르면 처음 너비).

> 0.6.x까지는 Pi Desktop·Pi Desktop Agent·Pi Desktop Mate를 따로 설치했습니다. 0.7.0에서 하나로 합쳤습니다 ([DESIGN-ONE-APP.md](docs/DESIGN-ONE-APP.md)).

### 함께 쓰는 것과 나눠 쓰는 것

자세히는 [DESIGN-APPS.md](docs/DESIGN-APPS.md).

- **함께 씀**: Pi 설치본, 로그인, 모델·프로바이더 설정(`~/.pi/agent`의 `auth.json`·`models.json`·`settings.json`), SSH 호스트 목록, 설치·업데이트. 로그인과 모델은 Pi 관리에서 한 번 하면 Agent·Mate도 씁니다.
- **나눠 씀**: 세션, 스킬·프롬프트·확장, MCP 서버, 사용자 지침(`AGENTS.md`), 기억·권한·작업 같은 데이터, 휴지통·아카이브.

| 작업 공간 | 데이터 홈 | 백그라운드 (앱을 닫아도 돈다) |
|---|---|---|
| Pi | Pi의 기본 폴더 `~/.pi/agent` + `~/.pi-desktop` | Host Agent 데몬 (홈 `~/.pi-desktop`) |
| Agent | `~/.pi-desktop-agent` | Host Agent 데몬 (홈 `~/.pi-desktop-agent`) + 예약 작업 세션 |
| Mate | `~/.pi-desktop-mate` | mate-runner 실행기 (로그인할 때 시작도 고를 수 있음) |

앱은 클라이언트이고, Pi는 Pi가 설치된 호스트(로컬·WSL·SSH)에서 돕니다.

## 설치

[Releases](https://github.com/soulfactorx/pi-desktop/releases)의 **Latest**에서 OS에 맞는 파일을 받습니다.

| OS | 파일 | 자동 업데이트 |
|---|---|---|
| Windows | `Pi-Desktop-Setup-<버전>.exe` | 업데이트할지 묻고 내려받은 뒤, 다시 시작해 설치할지 한 번 더 묻습니다 |
| macOS | `Pi-Desktop-<버전>-arm64.dmg` / `-x64.dmg` | 새 버전을 알리고 릴리스 페이지를 엽니다 (아래 "코드 서명") |
| Linux | `Pi-Desktop-<버전>-x86_64.AppImage` / `.deb` | AppImage는 Windows와 같고, deb는 알리기만 합니다 |

처음이라면 Pi 작업 공간의 **Pi 관리**에서 Pi 설치와 로그인을 마칩니다. 앱은 묻기 전에는 아무것도 내려받거나 설치하지 않습니다.

### 예전에 Agent·Mate를 따로 설치했다면

- 옛 Agent·Mate 앱은 0.7.0으로 마지막 업데이트를 받고, 열면 "Pi Desktop으로 합쳐졌습니다"를 보인 뒤 Pi Desktop을 엽니다 (없으면 내려받을 곳을 엽니다).
- 데이터(`~/.pi-desktop-agent`, `~/.pi-desktop-mate`)는 그대로 이어집니다. Pi Desktop이 처음 실행할 때 옛 앱의 지금 호스트·앱 수치·SSH 호스트를 한 번 옮깁니다.
- Mate의 "로그인할 때 실행기 시작"은 Pi Desktop이 이어받습니다.
- 옛 앱은 스스로 지우지 않습니다. 확인한 뒤 지우면 됩니다 (Windows: 설정 → 앱).

### 코드 서명

운영체제가 "이 프로그램을 누가 만들었고 그 뒤 바뀌지 않았다"를 확인하는 디지털 서명입니다. 지금은 인증서가 없어 서명하지 않으므로 다음처럼 동작합니다.

- Windows: 처음 설치할 때 SmartScreen이 "알 수 없는 게시자" 경고를 띄웁니다. "추가 정보 → 실행"을 누르면 됩니다. 자동 업데이트는 정상으로 동작합니다.
  - 서명하려면 코드 서명 인증서(연 수십만 원 수준)를 사서 CI 비밀 값으로 넣으면 됩니다.
- macOS: Gatekeeper가 처음 실행을 막습니다. Finder에서 앱을 우클릭 → "열기"로 엽니다. 서명이 없으면 macOS의 자동 설치가 거부되므로, 앱은 새 버전을 알리고 릴리스 페이지를 엽니다.
  - 서명하려면 Apple Developer Program(연 99달러) 가입과 공증(notarization)이 필요합니다.
- Linux: 서명이 필요 없습니다.

## Android 휴대폰에서 쓰기 (웹 버전 pi-web)

Electron 앱은 Android에서 돌지 않으므로, 휴대폰의 [Termux](https://termux.dev)에서 Pi와 웹 서버를 돌리고 휴대폰 브라우저(Chrome·삼성 인터넷)로 같은 화면을 엽니다. VS Code의 code-server와 같은 방식입니다.

```bash
curl -fsSL https://github.com/soulfactorx/pi-desktop/releases/latest/download/install-termux.sh | bash
```

| 명령 | 하는 일 |
|---|---|
| `pi-web start` | Pi Web과 Agent·Mate 작업 공간을 한 프로세스로 켜고 브라우저를 엽니다 (포트 8787·8788·8789). 화면 아래 막대에서 작업 공간을 바꿉니다 |
| `pi-web stop` · `restart` · `status` · `url` | 끄기 · 다시 켜기 · 상태 · 접속 주소(토큰 포함) |
| `pi-web log` | 서버 기록 |
| `pi-web update` | 최신 릴리스의 묶음으로 바꿉니다 (켜져 있던 것은 다시 켭니다) |
| `pi-web desktop\|agent\|mate start` | 하나만 따로 켭니다 |

웹 묶음(`pi-web.tar.gz`)과 설치 스크립트는 Pi Desktop 릴리스(Latest)에 함께 올라갑니다. 갤럭시 설정·내장 터미널 같은 자세한 내용은 [apps/desktop 설명서의 "Android 휴대폰에서 쓰기"](apps/desktop/README.md#android-휴대폰에서-쓰기-웹-버전-pi-web)에 있습니다.
예전 포크(`soulfactorx/pi-desktop-mobile`)에서 설치했다면 위 설치 명령을 한 번 다시 실행해 이 저장소로 옮깁니다.

## 저장소 구성

```
apps/
  desktop/        Pi Desktop: 창·셸(작업 공간 막대·메뉴·업데이트·설정 옮기기)과 Pi 작업 공간. 웹 서버(src/server)도 여기
  agent/          Agent 작업 공간: 본체(src/main/agent-main.ts)·화면·웹 서버. 단독 앱(src/main/index.ts)은 0.7.0 징검다리만
  mate/           Mate 작업 공간: 본체(src/main/mate-main.ts)·화면·웹 서버. 단독 앱(src/main/index.ts)은 0.7.0 징검다리만
packages/
  host-protocol/  앱 ↔ Host Agent 메시지 형식 (JSONL, JSON-RPC 2.0)
  host-agent/     대상 호스트에서 도는 상주 데몬(agentd)과 연결기(connect). Pi·Agent 작업 공간이 씀
  host-deploy/    Agent·Mate가 WSL·SSH 호스트에 번들과 kit을 올리고 그 호스트에서 실행할 명령을 만드는 코드
  agent-kit/      Agent의 기능 묶음. Pi 패키지(확장·스킬)라 터미널 pi에도 설치할 수 있음
  mate-kit/       Mate의 Pi 확장: 권한 단계 강제(mate-guard), 제안 도구(mate_propose)
  mate-runner/    Mate의 상주 실행기: 임무 시간표를 지키고 실행마다 pi --mode json을 띄움
  pi-isolation/   Agent·Mate가 자기 홈의 세션·스킬·MCP·지침만 Pi에 올리는 실행 옵션과 확장
  pi-resources/   Pi의 확장 가능한 데이터(스킬·MCP·프롬프트·패키지)를 관리하는 공용 코드 (데이터는 작업 공간마다 따로)
  tunables-ui/    "프롬프트와 수치" 화면 (세 작업 공간이 함께 씀)
  web-shell/      휴대폰 웹 껍데기: 서버 바탕·Electron 대체 모듈·이어지는 연결·서랍 메뉴
  window-state/   창 크기·위치 기억
docs/             설계 문서와 개발 방식
```

```
Pi Desktop 창
├─ Pi 작업 공간    ── host-agent connect → agentd(~/.pi-desktop) → pi --mode rpc
├─ Agent 작업 공간 ── host-agent connect → agentd(~/.pi-desktop-agent) → pi --mode rpc -e agent-kit
└─ Mate 작업 공간  ── mate-runner(~/.pi-desktop-mate) → pi --mode json -e mate-kit   (임무마다 한 번씩)
```

작업 공간 화면은 각 앱의 화면 빌드를 Pi Desktop 창 안의 iframe으로 엽니다. CSS·화면 코드가 섞이지 않고, preload가 프레임 주소로 그 화면의 API(`window.piDesktop`·`piAgent`·`mate`)만 만듭니다 ([DESIGN-ONE-APP.md §5](docs/DESIGN-ONE-APP.md)).

## 개발

- Node.js 22.19 이상 (Pi 요구 사항)
- Windows에서는 Git Bash (Pi의 bash 툴용)

```bash
npm install
```

npm 11은 설치 스크립트를 기본으로 막습니다. Electron·node-pty 설치 스크립트는 루트 `package.json`의 `allowScripts`로 허용해 두었습니다.

### 실행

API 키 없이 mock LLM(저장소의 Pi devDependency + OpenAI 호환 가짜 서버)으로 띄울 수 있습니다. Pi 설정과 데몬·실행기 홈은 저장소의 `.dev/` 아래로 격리되어 실제 `~/.pi`, `~/.pi-desktop*`과 섞이지 않습니다.

| 하려는 것 | mock LLM | 설치된 Pi |
|---|---|---|
| Pi 작업 공간 화면 고치기 (화면 즉시 반영) | `npm run dev:mock -w @pi-desktop/desktop` | `npm run dev` |
| 세 작업 공간 함께 (Agent·Mate 화면 고치기) | `npm run dev:mock:all -w @pi-desktop/desktop` | `npm run start:all -w @pi-desktop/desktop` |
| 휴대폰 웹 (세 서버 한 프로세스) | `npm run dev:web:all -w @pi-desktop/desktop` | `npm run build:web` 뒤 `node out/pi-web/server.mjs --workspaces` |

- `dev:mock`은 개발 서버로 띄워 Pi 화면을 고치면 바로 바뀝니다. 이때 Agent·Mate 작업 공간은 열리지 않습니다 (작업 공간 화면은 빌드한 파일이라서).
- `dev:mock:all`·`start:all`은 빌드한 앱을 띄웁니다. Agent·Mate 화면을 고쳤으면 다시 실행합니다. `npm run dev:mock -w @pi-desktop/agent`(또는 `mate`)도 이것을 부릅니다.
- mock에 보낼 수 있는 프롬프트 예(`안녕`, `read:package.json`, `bash:<명령>`, `fail:529` …)는 [apps/desktop 설명서](apps/desktop/README.md#api-키-없이-mock-llm으로-실행)에 있습니다.

### 검사와 테스트

```bash
npm run typecheck
```

```bash
npm test
```

`npm test`는 모든 워크스페이스를 돌립니다. host-agent·agent-kit·mate-runner에는 저장소의 Pi devDependency를 mock LLM과 함께 띄우는 **실제 Pi 계약 테스트**가 들어 있어 API 키가 필요 없습니다. 한 패키지만 돌릴 때는 `npm test -w @pi-desktop/<이름>`을 씁니다.
CI(`.github/workflows/ci.yml`)는 Windows·Linux와 Node 22·24에서 타입 검사, 테스트, 앱·웹 빌드를 돌립니다.

### 설치 파일과 릴리스

- `npm run dist -w @pi-desktop/desktop`: 지금 OS용 설치 파일을 `apps/desktop/release/`에 만듭니다 (올리지 않음). Agent·Mate 화면과 실행기·확장이 함께 들어갑니다.
- `npm run dist:web`: 휴대폰 웹 묶음과 설치 스크립트를 `release/web/`에 만듭니다.
- 릴리스는 태그 하나(`vX.Y.Z`)로 Pi Desktop 설치 파일(세 OS)과 웹 묶음을 한 릴리스에 올립니다 (`.github/workflows/release.yml`). 규칙은 [개발 방식 §6](docs/CONTRIBUTING.md#6-릴리스)과 [CLAUDE.md §3](CLAUDE.md).

## 문서

| 문서 | 내용 |
|---|---|
| [docs/DESIGN-ONE-APP.md](docs/DESIGN-ONE-APP.md) | 세 앱을 하나로: 작업 공간 구조, 플러그인 계약, 옮겨 가기, 단계 |
| [docs/DESIGN-APPS.md](docs/DESIGN-APPS.md) | 세 작업 공간의 역할과 데이터 경계: 함께 쓰는 것·나눠 쓰는 것, 데이터 위치, 프롬프트와 수치 |
| [docs/DESIGN.md](docs/DESIGN.md) | Pi 작업 공간(Pi Desktop) 설계: 원칙, Host Agent·상주 세션, 기능 모듈, 휴대폰 웹 |
| [docs/DESIGN-AGENT.md](docs/DESIGN-AGENT.md) | Agent 설계: agent-kit 구조, 기능 배치, 단계별 구현 메모 |
| [docs/DESIGN-MATE.md](docs/DESIGN-MATE.md) | Mate 설계: 임무·권한 단계·인박스, 활동 관찰, 텔레그램, Mate 대화 |
| [docs/DESIGN-MATE-REMOTE.md](docs/DESIGN-MATE-REMOTE.md) | Mate 원격 실행기: WSL·SSH 호스트에서 실행기 돌리기 |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 개발 방식: 언어 규칙, 커밋 단위·메시지, 브랜치·PR, main 룰셋, 릴리스 |

## 라이선스

[MIT](LICENSE). 설치 파일과 웹 묶음에 포함된 오픈 소스 패키지의 고지는 함께 들어 있는 `THIRD_PARTY_NOTICES.txt`에 있습니다.
