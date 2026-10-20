# Pi Desktop

[Pi coding agent](https://pi.dev)를 **포크하지 않고**, 설치된 `pi` 그대로 GUI로 쓰는 데스크톱 앱입니다.
Pi를 업데이트하면 앱도 그대로 따라갑니다.

- 설계: [docs/DESIGN.md](docs/DESIGN.md)
- 현재 단계: **M0 스파이크** — 로컬 Pi와 스트리밍 채팅, GUI를 닫아도 작업이 계속되고 다시 열면 이어 붙기

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
- 프롬프트 예: `안녕` → 그대로 echo, `read:package.json` → read 툴 호출 후 내용 응답

### 설치된 Pi로 실행

```bash
npm run dev
```

`npm install -g @earendil-works/pi-coding-agent`로 설치되어 있고 `pi`에서 `/login`이 끝나 있어야 합니다.

## 테스트

```bash
npm test
```

- `host-protocol`: 프레이밍(U+2028, 멀티바이트 경계 등)과 JSON-RPC
- `host-agent`: 가짜 Pi로 데몬·재연결·저널 잘림 검증, **실제 Pi 1.3.0 + mock LLM 계약 테스트**
- `desktop`: 이벤트 → 채팅 상태 리듀서

## M0 알려진 한계

- 저널은 메모리에만 있어 데몬이 재시작되면 스트리밍 중간 상태가 사라집니다 (Pi 세션 파일은 남음). 디스크 저널은 M1.
- 저널에서 잘린 구간은 안내만 하고, `get_messages` 스냅샷 복구는 M1.
- Windows에서 분리 실행한 데몬이 Electron의 상속 가능한 핸들을 물려받는 현상을 확인했습니다
  (예: `PI_DESKTOP_REMOTE_DEBUG_PORT` 포트가 앱 종료 후에도 점유됨). 데몬 실행 방식 개선은 M1.
- 마크다운 렌더링, 디자인 시스템, 패키징(인스톨러)은 아직 없습니다.
