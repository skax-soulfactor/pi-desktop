# Pi Desktop

[Pi coding agent](https://pi.dev)를 **포크하지 않고**, 설치된 `pi` 그대로 GUI로 쓰는 데스크톱 앱입니다.
Pi를 업데이트하면 앱도 그대로 따라갑니다.

- 설계: [docs/DESIGN.md](docs/DESIGN.md)
- 현재 단계: **M1 진행 중** — 로컬·WSL의 Pi와 스트리밍 채팅, GUI를 닫아도 작업이 계속되고 다시 열면 이어 붙기

## 구조

```
apps/desktop/          Electron 앱 (main · preload · React 렌더러)
packages/host-protocol 앱 ↔ Host Agent 메시지 형식 (JSONL, JSON-RPC 2.0)
packages/host-agent    대상 호스트에서 도는 상주 데몬(agentd)과 연결기(connect)
```

앱은 `host-agent connect`를 띄워 데몬에 붙고, 데몬이 `pi --mode rpc` 프로세스와 이벤트 저널을 소유합니다.
그래서 앱을 닫아도 Pi는 계속 작업하고, 다시 열면 놓친 이벤트를 재생해 이어서 보여줍니다 (설계 §3.4).

## 개발 환경

- Node.js 22.19 이상 (Pi 요구 사항)
- Windows에서는 Git Bash (Pi의 bash 툴용)

```bash
npm install
```

npm 11은 설치 스크립트를 기본으로 막습니다. Electron 바이너리 다운로드는 루트 `package.json`의 `allowScripts`로 허용해 두었습니다.

## 실행

### API 키 없이 mock LLM으로 실행

```bash
npm run dev:mock -w @pi-desktop/desktop
```

- 저장소의 Pi devDependency(1.3.0)와 OpenAI 호환 mock LLM(포트 18911)을 씁니다.
- Pi 설정과 데몬 홈은 저장소의 `.dev/` 아래로 격리되어 실제 `~/.pi`, `~/.pi-desktop`과 섞이지 않습니다.
- 프롬프트 예: `안녕` → 그대로 echo, `read:package.json` → read 툴 호출 후 내용 응답, `bash:<명령>` → bash 툴 호출
- `-- --demo-ext`를 붙이면 Pi에 들어 있는 rpc-demo 확장을 함께 불러옵니다. 확장 UI(다이얼로그·알림·위젯·상태)를 확인할 때 씁니다.
  - `/rpc-input`, `/rpc-editor`, `/rpc-prefill` 명령, `bash:rm -rf ./x`(위험 명령 확인 다이얼로그)

### 설치된 Pi로 실행

```bash
npm run dev
```

상단의 호스트 선택에서 Pi가 설치된 곳을 고릅니다.

- **로컬 (Windows)**: `npm install -g @earendil-works/pi-coding-agent`로 설치하고 `pi`에서 `/login`을 해 두어야 합니다.
- **WSL: <배포판>**: WSL 안에 Pi가 설치되어 있고(공식 설치기 또는 npm) 로그인되어 있으면 됩니다.
  - 앱이 Host Agent를 WSL 홈의 `~/.pi-desktop/agent/`에 자동으로 올리고, WSL 안에 데몬을 띄웁니다.
  - 작업 폴더는 WSL 안의 경로(예: `/home/me/project`)로 입력합니다. 폴더 선택 대화상자는 로컬 전용입니다.
  - WSL에 Node.js 22 이상이 필요합니다. Pi 공식 설치기가 깐 Node도 자동으로 찾습니다.

앱은 마지막으로 고른 호스트를 기억하고, 다시 열면 그 호스트의 최근 세션에 자동으로 다시 붙습니다.

## 테스트

```bash
npm test
```

- `host-protocol`: 프레이밍(U+2028, 멀티바이트 경계 등)과 JSON-RPC
- `host-agent`: 가짜 Pi로 데몬·재연결·저널 잘림 검증, **실제 Pi 1.3.0 + mock LLM 계약 테스트**
- `desktop`: 이벤트 → 채팅 상태 리듀서

## 세션 복구 동작

- **앱을 닫았다 열거나 연결이 끊겼다 붙으면**: 데몬의 이벤트 저널에서 놓친 부분을 재생해 이어서 보여줍니다.
- **저널 앞부분이 잘렸으면** (세션당 최근 1만 이벤트만 보관): Pi의 `get_messages`로 대화 전체를 받아 화면을 다시 만듭니다.
- **데몬이 재시작되었거나 Pi가 종료되면**: 대화는 화면에 남기고 "다시 열기"를 보여줍니다. 누르면 같은 Pi 세션 파일로 다시 열어 대화를 이어 갑니다. 진행 중이던 턴은 이어지지 않습니다.

## 알려진 한계

- 디자인 시스템과 패키징(인스톨러)은 아직 없습니다.
- 모델 선택은 일반 목록이라 모델이 수백 개(예: openrouter)면 길어집니다. 검색 가능한 선택기는 후속 작업입니다.
- WSL 내부 폴더 탐색 UI가 없어 경로를 직접 입력합니다.
- Windows에서 데몬은 WMI로 띄웁니다 (앱 핸들 상속 방지). 문제를 조사할 때는 `PI_DESKTOP_DAEMON_SPAWN=direct`로 예전 방식을 쓸 수 있습니다.
