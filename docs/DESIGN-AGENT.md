# Pi Desktop Agent — 설계 문서 (v0.2)

> 관련 문서: [Pi Desktop 설계](DESIGN.md) — 이 문서는 그 위에 올라가는 두 번째 앱을 다룬다.

Pi Desktop이 "설치된 Pi를 그대로 GUI로 쓰는 앱"이라면, Pi Desktop Agent는 **Pi를 엔진으로 삼아 내가 원하는 기능을 가진
데스크톱 에이전트**다. 사용자가 채팅으로 요청하면 에이전트가 LLM과 로컬 도구를 조합해 처리하되,
**데스크톱 자원에 손대는 일은 사용자 승인을 거친다.**

이전에 따로 만들던 `desktop-agent`(Vercel AI SDK 기반 자체 루프)의 기능과 설계를 Pi 위에서 처음부터 다시 구현한다.
기존 코드·데이터는 가져오지 않는다. 데이터 형식, 루프, 세션, 설정은 모두 Pi 것을 그대로 쓴다.

---

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 저장소 | **pi-desktop 모노레포에 추가한다.** `apps/agent`(Electron 앱) + `packages/agent-kit`(기능 = Pi 패키지) |
| 엔진 | 수정하지 않은 `pi`. Host Agent 데몬이 `pi --mode rpc`로 띄운다 (DESIGN.md §3.4 그대로) |
| 기능 구현 위치 | **Pi 확장·스킬**(`agent-kit`). 앱은 Pi 프런트엔드일 뿐이다 |
| 데몬 | Pi Desktop과 **같은 Host Agent 코드, 다른 데몬 홈**(`~/.pi-desktop-agent`). 두 앱이 서로의 데몬을 교체하지 않게 한다 |
| 제품 이름 | Pi Desktop Agent (`@pi-desktop/agent`). 단, Host Agent 실행 파일 이름이 이미 `pi-desktop-agent`이므로 문서·로그에서는 "에이전트 앱"과 "Host Agent"를 구분해 쓴다 |
| Pi Desktop과의 분리 | `apps/desktop`과 루트 README는 고치지 않는다. 겹치는 파일은 `package-lock.json`뿐이다. 작업은 별도 worktree(`../pi-desktop-agent`)의 `feat/agent-*` 브랜치에서 한다 |
| 릴리스 | Pi Desktop의 `v*` 태그·워크플로·GitHub Releases와 섞지 않는다. 에이전트는 `agent-v*` 태그와 별도 워크플로, 별도 배포 위치를 쓴다. 같은 Releases에 올리면 Pi Desktop의 자동 업데이트가 에이전트 릴리스를 최신 버전으로 착각할 수 있다 |
| 기존 desktop-agent | 자동 업데이트로 배포된 상태라 그 저장소에서 갈아엎지 않는다. 기능 목록과 설계 근거를 참고하는 용도로만 남긴다 |

## 1. 핵심 원칙

| 원칙 | 의미 |
|---|---|
| **Zero-fork** | Pi 소스를 수정하지 않는다. 확장 API, RPC, 설정 파일만 쓴다 (DESIGN.md §1) |
| **Pi가 소유한 파일이 진실의 원천** | 세션 JSONL, `settings.json`, `models.json`, 스킬, `AGENTS.md`를 그대로 쓴다. 에이전트 앱에서 만든 세션을 터미널 `pi`나 Pi Desktop에서 이어 갈 수 있다 |
| **기능은 확장으로, 어디서나 동작** | `agent-kit`의 확장은 `ctx.ui`로만 사용자와 대화한다. 앱 전용 경로(풍부한 승인 화면 등)는 있으면 쓰고, 없으면 `ctx.ui`로 대체한다. 그래서 터미널 `pi`에 설치해도 동작한다 |
| **사람이 없으면 안전한 쪽으로** | `ctx.hasUI`가 false인 실행(예약 작업, 피어 요청)에서는 승인이 필요한 도구를 거부한다 |
| **승인은 동의 절차이지 보안 경계가 아니다** | Pi security.md가 밝히듯 확장 hook은 경계가 아니다. 강한 격리는 샌드박스 옵션으로 따로 제공한다 |

Pi와 의도적으로 다른 점은 하나다. Pi는 기본적으로 도구 실행 전에 묻지 않지만, 이 앱은 **승인 확장을 기본으로 켠다.**
이것도 Pi가 열어 둔 `tool_call` hook으로 구현하므로 Zero-fork 원칙과 충돌하지 않는다.

## 2. 구조

```
┌ apps/agent (Electron) ─────────────────────────────────────────────┐
│ Renderer: 채팅(Pi 세션 이벤트) · 승인 모달 · 기억 · 스케줄 · 작업     │
│   └ Pi Desktop의 chat-state·ChatView·ToolCards·ExtensionUi 재사용    │
│ Main: HostConnection(로컬) · agent-kit 경로 결정 · IPC                │
│   └ Pi Desktop의 host-connection·node-runtime·agent-build 재사용     │
└──────────────┬─────────────────────────────────────────────────────┘
               │ stdio JSON-RPC (packages/host-protocol)
┌──────────────▼──────────── host-agent connect → host-agentd ────────┐
│ PI_DESKTOP_HOME=~/.pi-desktop-agent  (Pi Desktop 데몬과 분리)         │
│   ├ pi --mode rpc -e <agent-kit 확장들>   (세션 A)                    │
│   └ pi --mode rpc -e <agent-kit 확장들>   (세션 B, 워커 …)            │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 agent-kit을 불러오는 방법

DESIGN.md §5.3의 bridge 확장과 같은 방식이다. 세션을 열 때 `session.open`의 `piArgs`에 `-e <확장 파일>`을 넣는다.
사용자 `settings.json`의 `packages`에는 기록하지 않는다. 그래서

- 에이전트 앱에서 연 세션에만 agent-kit이 올라가고, 터미널 `pi`나 Pi Desktop의 세션에는 영향이 없다.
- 터미널에서도 쓰고 싶으면 사용자가 직접 `pi install`로 설치하면 된다 (`package.json`의 `pi.extensions`가 그대로 쓰인다).

앱은 확장 목록을 `agent-kit/package.json`의 `pi.extensions`에서 읽어 확장마다 `-e`를 붙인다.
보내기 전에 `get_commands`에 `agent:status`가 있는지로 agent-kit이 실제로 올라갔는지 확인한다.

### 2.2 데몬 홈을 나누는 이유

Host Agent 연결기는 떠 있는 데몬의 빌드 식별자가 자기 번들과 다르면, 세션이 없을 때 데몬을 교체한다(agent-build.ts).
두 앱이 따로 배포되면 번들이 달라지므로 같은 데몬을 쓰면 서로 교체하려 든다.
에이전트 앱은 연결기 환경에 `PI_DESKTOP_HOME`을 주어 데몬·소켓·저널을 따로 쓴다.
Pi 설정과 세션(`~/.pi/agent`)은 나누지 않는다. 같은 Pi를 쓰는 것이 이 구조의 핵심이다.

### 2.3 재사용 경계

| 가져다 쓰는 것 | 위치 | 방식 |
|---|---|---|
| Host Agent 데몬·연결기 | `packages/host-agent` | 빌드 결과(`dist/host-agent.mjs`)를 그대로 실행 |
| 앱 ↔ 데몬 메시지 | `packages/host-protocol` | 워크스페이스 패키지 |
| 연결 관리, Node 런타임 찾기, 빌드 식별자 | `apps/desktop/src/main` | **복사** (`apps/agent/src/vendor/main`) |
| 채팅 상태·화면, 도구 카드, 확장 UI | `apps/desktop/src/renderer` | **복사** (`apps/agent/src/vendor/renderer`) |

P0는 `@desktop` 별칭으로 Pi Desktop 소스를 직접 가져다 썼다. 처음에는 P1에서 공용 패키지(`packages/desktop-core`·`chat-ui`)로
옮길 계획이었지만, 그러려면 Pi Desktop을 고쳐야 해서 "Pi Desktop은 건드리지 않는다"(§0)와 맞지 않는다.
직접 import를 그대로 두면 Pi Desktop을 고칠 때 에이전트 빌드와 Pi Desktop PR의 CI가 함께 깨진다.
그래서 **P1에서 복사로 바꿨다** (v0.2). 출처 커밋과 다시 가져오는 규칙은 `apps/agent/src/vendor/README.md`에 있다.

## 3. 데이터 위치

| 무엇 | 어디 | 비고 |
|---|---|---|
| 세션, 설정, 모델, 스킬, 프롬프트, `AGENTS.md` | `~/.pi/agent/` | Pi 형식 그대로. Pi Desktop·TUI와 공유 |
| agent-kit 상태 (승인 정책, 감사 로그, 기억, 스케줄, 피어) | `~/.pi/agent/pi-desktop-agent/` | 확장이 쓰는 파일. 사람이 읽고 고칠 수 있는 JSON·JSONL·Markdown |
| 세션 안의 확장 상태 | 세션 JSONL의 `custom` 엔트리 | LLM에 보이지 않음 (예: 이 세션 한정 승인) |
| 모델이 알아야 하는 주입 내용 | 세션 JSONL의 `custom_message` 엔트리 | 예: 작업 완료 알림, 피어 응답 |
| 데몬·저널 | `~/.pi-desktop-agent/` | Host Agent 런타임 파일 |
| 창 배치 등 앱 전용 상태 | Electron `userData` | DESIGN.md §1과 같은 규칙 |

API 키는 Pi의 방식(`auth.json`, 환경 변수, `models.json`의 `$ENV` 참조)을 따른다.
평문 저장을 피하고 싶으면 앱이 OS 키체인에서 꺼내 세션 환경 변수로 넘기고 `models.json`에서 `$ENV`로 참조하는 방식을 P3에서 제공한다.

## 4. 기능 배치

desktop-agent에 있던 기능을 Pi의 어느 부분으로 옮길지 정한다.

| 기능 | 위치 | 구현 |
|---|---|---|
| 파일 읽기·쓰기, 셸 | **Pi 기본 도구** | `read`/`write`/`edit`/`grep`/`find`/`ls`/`bash`, Windows는 `powershell`도 |
| 승인 게이트, 정책, 감사, 위험 명령 차단 | 확장 `permissions` | `tool_call`에서 block. 앱이 있으면 풍부한 승인 화면, 없으면 `ctx.ui.select`. `hasUI` false면 거부 |
| 권한 상승 | 확장 `permissions` | 별도 도구. 사람이 보고 있을 때만 활성 (`setActiveTools`) |
| HTTP 요청, 웹 검색 | 확장 `web` | `registerTool` |
| 메인/워커 분리, 작업 위임 | 확장 `tasks` | 워커는 별도 Pi 세션. 진행은 `onUpdate`, 완료는 `custom_message`로 주입 |
| 예약·주기 작업 | Host Agent + 확장 `schedule` | 타이머는 앱이 꺼져도 도는 데몬에 둔다. 확장은 등록·조회 도구만 |
| 지식베이스 (회상·추출·교훈) | 확장 `memory` | `before_agent_start`에서 관련 기억을 프롬프트 섹션으로, `agent_settled`에서 추출. 저장은 Markdown 파일 |
| 사용자 지침·선호 | **Pi 기본** | `AGENTS.md` |
| 스킬, MCP | **Pi 기본** | `skills/`, `mcp.json` |
| 큰 입력 처리 | 확장 `documents` | 원문은 파일로, `read`의 offset/limit로 읽기. 분할 요약·번역은 워커 세션 |
| docx 등 첨부 변환 | 확장 `attachments` | `input` 이벤트에서 변환 후 파일 경로 전달 |
| 되묻기 | 확장 `ask-user` | `ctx.ui.select`/`input`을 도구로 노출 |
| 로컬 모델 대응 | 확장 `local-model` + `models.json` | 도구 결과 축소(`tool_result`), 도구 줄이기, 서버 창 크기 실측. 압축 설정(`reserveTokens`, `keepRecentTokens`)을 창에 맞게 |
| 반복·제자리 돌기 차단 | 확장 `loop-guard` | `tool_call`에서 반복 조회·거절 무시 차단, `turn_end`에서 문단 반복 감지 |
| 에이전트 네트워크(A2A) | 앱/데몬 + 확장 `peers` | 전송·카드·중계는 앱/데몬, 피어 호출 도구는 확장 |
| 사용량 | **Pi 기본** | 세션의 `usage` 엔트리를 집계해 화면에 보인다 |

## 5. 단계

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **P0 골격** | `agent-kit` 패키지와 `agent-core` 확장(`/agent:status`), `apps/agent`가 분리된 데몬에 붙어 agent-kit을 올린 로컬 세션으로 채팅, 확장 다이얼로그 응답, mock LLM 개발 실행 | `npm run dev:mock -w @pi-desktop/agent`로 대화하고, 실제 Pi 계약 테스트로 agent-kit이 올라가는 것을 확인 |
| | **구현 메모 (P0 완료)**: 실제 Pi 1.3.0 계약 테스트(`packages/agent-kit/test/real-pi.test.ts`)와 dev:mock 앱에서 데몬 연결 → agent-kit 확인 → `/agent:status` 알림 → 스트리밍 응답 → read 도구 카드까지 확인. 프로젝트 신뢰는 묻지 않으므로(RPC) 처음 연 폴더의 `.pi/` 리소스는 건너뛴다. 설치본 묶음(extraResources의 agent-kit·host-agent)은 아직 없음 | |
| **P1 승인** | `permissions` 확장, 앱 승인 화면, Pi Desktop 모듈 복사(§2.3) | 승인 없이는 쓰기·실행이 일어나지 않는다 |
| | **구현 메모 (P1 완료)**: 읽기 도구(read·grep·find·ls)는 묻지 않고, 쓰기(write·edit)·실행(bash·powershell·모르는 도구)은 `ctx.ui.select`로 묻는다. 선택지는 이번만·이 세션에서 계속·항상(규칙 저장)·거부이고, 취소와 시간 초과는 거부다. 위험 명령과 권한 상승은 묻지 않고 막는다. 규칙은 `permissions.json`, 판단은 `audit.jsonl`. 앱은 select 제목의 승인 형식(`agent-kit/approval`)을 읽어 전용 화면을 띄운다. 실제 Pi 계약 테스트(`permissions-real-pi.test.ts`)와 dev:mock 앱에서 허용·거부 흐름을 확인 | |
| P2 로컬 모델 | `local-model`, `loop-guard`, 압축 설정 | qwen3.5:9b로 desktop-agent와 같은 시나리오 비교 |
| P3 기본 기능 | `memory`, `documents`, `attachments`, `ask-user`, `web`, 키체인 연동 | |
| P4 백그라운드 | `tasks`(워커 세션), 데몬 스케줄러, 알림 | 앱을 닫아도 예약 작업이 돈다 |
| P5 확장 | `peers`/네트워크, 권한 상승, 배포 설정 | |

## 6. 리스크

| 리스크 | 대응 |
|---|---|
| Pi 변경이 빠름 (1.x에서 주 2회 수준 릴리스) | 저장소의 Pi devDependency로 계약 테스트. agent-kit이 쓰는 이벤트만 검사한다 |
| RPC 확장 UI의 표현력이 낮음 (문자열 선택지 수준) | P1은 승인 정보를 select 제목에 정해진 형식으로 싣고, agent-kit의 같은 함수로 만들고 읽는다. 터미널 pi에서도 그대로 읽힌다. 더 많은 정보가 필요해지면 앱 전용 경로를 검토 |
| 복사한 Pi Desktop 모듈이 원본과 멀어짐 | 되도록 고치지 않고, 고친 곳에는 `// agent:` 주석. 다시 가져올 때 출처 커밋을 갱신 (vendor/README.md) |
| Windows 셸 | Pi 기본 `bash`는 Git Bash가 필요하다. 회사 PC를 고려해 `powershell` 도구를 켜는 설정을 P2에서 기본값으로 검토 |
| 9B 로컬 모델의 지시 따르기 | 엔진을 바꿔도 해결되지 않는다. `loop-guard`처럼 코드로 강제하는 장치를 유지하고 P2에서 측정한다 |
