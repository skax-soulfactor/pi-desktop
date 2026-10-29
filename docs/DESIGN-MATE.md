# Pi Desktop Mate — 설계 문서 (v0.1)

> 관련 문서: [Pi Desktop 설계](DESIGN.md), [Pi Desktop Agent 설계](DESIGN-AGENT.md) (별도 세션에서 작업 중)

Pi Desktop Mate는 **사용자가 묻기 전에 Pi가 스스로 살펴보고, 알릴 것은 알리고, 할 일은 허락을 받은 뒤 하는** 능동형 코딩 동료다.
Pi Desktop(설치된 Pi의 GUI)과 Pi Desktop Agent(채팅형 데스크톱 에이전트)와는 **별도 앱**이다.
Pi를 포크하지 않는다는 원칙은 같다. Pi는 그대로 두고, 확장(`mate-kit`)과 상주 실행기(`mate-runner`), 앱(`apps/mate`)을 새로 만든다.

---

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 저장소 | pi-desktop 모노레포에 추가. `apps/mate`(Electron 앱) + `packages/mate-kit`(Pi 확장) + `packages/mate-runner`(상주 실행기) |
| 기존 코드와의 분리 | `apps/desktop`, `packages/host-agent`, 루트 README, `DESIGN.md`는 **고치지 않는다**. host-agent의 Pi 찾기·데몬 띄우기 코드는 읽기만 하고 번들에 넣어 쓴다. 겹치는 파일은 `package-lock.json`뿐 |
| Pi Desktop Agent와의 분리 | 이름(`mate`)·폴더·데이터 홈·포트·태그를 모두 나눈다 (§7). 작업은 별도 worktree(`../pi-desktop-mate`)의 `feat/mate-*` 브랜치에서 한다 |
| 메타 파일 | **`~/.pi-desktop-mate/`** 에 따로 둔다 (`MATE_HOME`으로 바꿈). Pi 설정·인증·모델(`~/.pi/agent`)은 같이 쓴다 (API 키를 다시 넣지 않도록) |
| 기본 모델 | `anthropic/claude-haiku-5-5` (Mate 설정에서 바꿈, 임무마다 덮어쓸 수 있음) |
| 알림 | **앱을 켰을 때 본다.** 실행 결과·제안·승인 요청은 모두 인박스에 쌓여 대기한다. 실시간 푸시·트레이는 나중에 |
| 릴리스 | Pi Desktop의 `v*`, Agent의 `agent-v*`와 섞지 않고 `mate-v*` 태그와 별도 워크플로를 쓴다 (설치본은 M3 이후) |

## 1. 참고한 제품

2026년 9~10월에 나온 능동형(proactive) 에이전트 세 가지에서 공통점을 뽑았다. 출시 직후의 보도와 리뷰를 바탕으로 했으므로 세부는 바뀔 수 있다.

| | Meta Muse (9월) | OpenAI Dots (9~10월) | Claude Duet (10월, 미리보기) |
|---|---|---|---|
| 도는 곳 | 앱을 닫아도 계속 일함 | 에이전트마다 클라우드 컴퓨터 | 전용 클라우드 VM·브라우저 |
| 먼저 말 거는 방식 | 목표와 관련된 정보가 바뀌면 계획 변경 제안, 일정·마감 알림 | 놀 때 연결된 앱을 훑어 도울 거리를 찾음 | 아침 요약, 몇 시간마다 연결된 계정 확인 |
| 권한 | 메일 보내기·예약·결제까지 | 훑을 때는 **읽기 전용** | 보내기·결제·서명·삭제 전 **승인 요청** |

공통점:

1. **항상 켜져 있다.** 앱을 닫아도 정해진 때에 일한다.
2. **계기(trigger)가 있다.** 시간표, 변화 감지, 주기적 훑기.
3. **살펴보기는 읽기 전용, 행동은 승인 뒤.** 위험한 일은 아예 막는다.
4. **결과는 알림·제안으로 돌아온다.** 사용자는 받아들이거나 버린다.
5. **비용·소음·보안이 핵심 위험이다.**

Mate의 "할 일"은 개인 비서가 아니라 **코딩 작업 공간**이다: 아침 브리핑(git·PR·CI 상태), 테스트 감시, CI·리뷰 대응, 의존성·보안 점검, 원격 서버 지킴이.

## 2. 구조

```
┌ apps/mate (Electron) ──────────────────────────────────────┐
│ 인박스(제안·승인 대기) · 임무 목록 · 실행 기록 · 설정            │
│ Main: ~/.pi-desktop-mate 파일 읽기·쓰기·감시, 실행기 띄우기      │
└──────────────┬────────────────────────────────────────────┘
               │ 파일 (임무 JSON, 실행 요청, 인박스 JSONL, 상태)
┌──────────────▼──── mate-runner daemon (상주, 앱을 닫아도 돎) ┐
│ 시간표 확인(30초마다) · 실행 요청 처리 · 하루 횟수 제한            │
│   └ pi --mode json -e <mate-kit 확장> --tools <읽기 도구> ...   │
│        (실행마다 새 Pi 프로세스, 끝나면 종료)                    │
└────────────────────────────────────────────────────────────┘
```

### 2.1 Host Agent 데몬을 쓰지 않는 이유

처음 안(PROACTIVE-AGENTS 초안 B)은 Host Agent 데몬 안에 실행기를 넣는 것이었다. 별도 앱으로 바꾸면서 다음 이유로 **자체 실행기**를 둔다.

- Host Agent는 Pi Desktop의 것이다. 고치면 Pi Desktop 릴리스와 엮이고, 다른 세션(Agent)과도 겹친다.
- 백그라운드 실행은 "한 번 돌고 끝나는" 작업이라 `pi --mode json`(실행 후 종료)이 딱 맞는다. 세션 붙이기·저널·대기 다이얼로그가 필요 없다.
- 승인을 "열린 세션이 기다리는 다이얼로그"로 하지 않는다 (§4). 앱이 몇 시간 꺼져 있어도 Pi 프로세스를 붙잡아 둘 필요가 없다.

Pi 찾기(`locatePi`)와 Windows에서 부모 핸들을 물려받지 않게 데몬 띄우기(`spawnDaemon`)는 host-agent 소스를 그대로 번들해 쓴다(수정 없음).

### 2.2 앱과 실행기 사이

소켓 대신 **파일**로 주고받는다. 같은 사용자의 홈 폴더라 인증이 따로 필요 없고, 앱이 꺼져 있어도 상태가 남는다.

| 파일 | 쓰는 쪽 | 읽는 쪽 |
|---|---|---|
| `config.json` (기본 모델, 일시 정지, 하루 실행 상한) | 앱 | 실행기 |
| `duties/<id>.json` (임무) | 앱 | 실행기 |
| `requests/<시각>-<id>.json` ("지금 실행") | 앱 | 실행기 (처리 후 지움) |
| `state.json` (임무별 마지막 실행, 오늘 실행 수, 지금 도는 실행) | 실행기 | 앱 |
| `runs/<runId>.json` (실행 기록: 상태·요약·비용·세션 파일) | 실행기 | 앱 |
| `inbox.jsonl` (제안, 추가만 함) | mate-kit 확장 | 앱 |
| `inbox-state.json` (제안별 받아들임·버림) | 앱 | 앱·실행기 |
| `sessions/` (실행마다의 Pi 세션 JSONL) | Pi | 앱 (나중에 "세션 열기") |
| `run/mated.pid`, `run/mated.log` | 실행기 | 앱 |

인박스는 추가만 하는 JSONL과 상태 파일을 나눠, 확장의 추가와 앱의 상태 변경이 같은 파일을 동시에 고치지 않게 한다.
Pi 세션을 `~/.pi/agent/sessions`가 아니라 Mate 홈에 두는 것은 백그라운드 실행이 Pi Desktop·TUI의 세션 목록을 채우지 않게 하기 위해서다. 형식은 Pi 그대로다.

### 2.3 실행기 수명

- 앱이 켜질 때 실행기가 없으면 띄운다. 실행기는 앱을 닫아도 남아 시간표를 지킨다.
- 하나만 돈다(`run/mated.pid` + 프로세스 확인).
- 실행기가 꺼져 있던 동안 놓친 시간표는 **한 번만** 따라잡는다.
- 로그인 시 자동 시작은 아직 없다. PC를 다시 켠 뒤 앱을 한 번 열어야 실행기가 다시 돈다 (M3에서 로그인 항목 검토).

## 3. 임무(Duty)

```json
{
  "id": "morning-brief",
  "name": "아침 브리핑",
  "enabled": true,
  "cwd": "C:/Users/me/my-project",
  "prompt": "git 상태, 열린 PR과 CI를 확인해 오늘 할 일을 3줄로 요약하라.",
  "profile": "propose",
  "trigger": { "kind": "daily", "time": "09:00", "weekdays": [1, 2, 3, 4, 5] },
  "model": "anthropic/claude-haiku-5-5",
  "timeoutSec": 300,
  "createdAt": 1793000000000
}
```

계기 (M1):

- `manual`: "지금 실행"으로만.
- `interval`: N분마다 (최소 15분).
- `daily`: 매일(또는 정한 요일) 정한 시각. 만든 시각 이전의 시간표는 따라잡지 않는다.

파일·git 변화, 명령 결과 폴링, 세션 종료 계기는 M2에서 더한다.

## 4. 권한 단계와 승인

권한은 모델의 말이 아니라 **실행 인자와 확장 코드로** 강제한다.

| 단계 | 모델에 주는 도구 | 막는 것 |
|---|---|---|
| `observe` | read·grep·find·ls·bash | write·edit는 도구 목록에 아예 없음. bash는 허용 목록의 읽기 명령만(`mate-guard`) |
| `propose` (기본) | observe + `mate_propose` | 같음. 제안은 인박스에만 쌓인다 |
| `act` (M3) | 아래 참고 | push·배포·삭제·자격 증명 접근은 언제나 금지 |

- `--tools`로 도구 목록을 정하고(쓰기 도구는 선언조차 안 됨), `mate-guard` 확장이 `tool_call`에서 한 번 더 막는다.
  Pi security.md가 말하듯 확장 hook은 보안 경계가 아니다. 이 단계는 "실수로 손대지 않게"하는 장치이고, 강한 격리는 M3의 worktree·샌드박스로 다룬다.
- bash 허용 목록: `git status/log/diff/show/branch/remote -v`, `gh pr|run|issue view|list|checks|status`, `ls/cat/head/tail/wc/grep/rg/find`(쓰기 옵션 제외), `npm ls/outdated/view`, `node -v` 등. 파이프는 각 단계가 모두 허용될 때만, 리다이렉트(`>`)·명령 치환은 막는다.
- 읽은 내용(코드·이슈·로그) 속 지시는 데이터로만 다루라고 시스템 프롬프트에 넣는다.

**승인은 "대기하는 세션"이 아니라 "대기하는 인박스 항목"이다.** 앱이 꺼져 있는 동안 생긴 승인 건은 모두 인박스에 쌓이고,
사용자가 앱을 열어 받아들일 때 실제 행동이 일어난다. `act`(M3)는 이렇게 한다.

1. 실행기가 git worktree를 만들어 그 안에서 쓰기 도구를 허용해 실행한다 (사용자 작업 폴더는 그대로).
2. 결과(브랜치·diff)를 인박스에 "승인 대기"로 올린다.
3. 사용자가 받아들이면 앱이 그 브랜치를 합치거나 패치를 적용한다. 버리면 worktree를 지운다.

## 5. 인박스

- `mate_propose` 입력: 제목, 요약, 상세(근거·파일·명령 출력, Markdown), 중요도(`info`·`warn`·`action`).
- 같은 임무에서 제목+요약이 같은 제안은 다시 알리지 않는다(해시로 중복 제거, 버린 것도 기억).
- 앱에서: **받아들이기**(M1은 "확인함" 표시, M3부터 적용), **버리기**. 안 본 제안 수를 배지로 보인다.
- 실행이 제안 없이 끝나면 마지막 답변을 실행 기록에 요약으로 남긴다.

## 6. 예산과 안전

- 전체 일시 정지, 하루 전체 실행 상한(기본 20회), 실행 시간 제한(기본 300초, 넘으면 프로세스 종료).
- 실행은 한 번에 하나씩(비용·충돌 줄이기).
- 비용은 Pi의 메시지 `usage.cost`를 합쳐 실행 기록에 남긴다. 실행당 비용 상한은 M2.

## 7. Pi Desktop·Agent와 겹치지 않게

| | Pi Desktop | Pi Desktop Agent | Pi Desktop Mate |
|---|---|---|---|
| 앱 폴더·패키지 | `apps/desktop` (`@pi-desktop/desktop`) | `apps/agent`, `packages/agent-kit` | `apps/mate`, `packages/mate-kit`, `packages/mate-runner` |
| 데이터 홈 | `~/.pi-desktop` | `~/.pi-desktop-agent`, `~/.pi/agent/pi-desktop-agent` | `~/.pi-desktop-mate` |
| 개발 mock LLM 포트 | 18911 | 18912 | 18913 |
| 개발 데이터 | `.dev/home` | `.dev/agent-home` | `.dev/mate-home` |
| 태그 | `v*` | `agent-v*` | `mate-v*` |

Agent 설계의 P4(데몬 스케줄러·백그라운드 작업)는 Mate와 목적이 겹친다. 둘 다 자리 잡으면 실행기를 공용 패키지로 합칠지 그때 정한다.
지금은 서로의 코드를 import하지 않는다.

## 8. 단계

| 단계 | 내용 | 확인 방법 |
|---|---|---|
| **M1** | mate-kit(`mate-guard`, `mate_propose`), 실행기(임무·시간표 manual/interval/daily·지금 실행·하루 상한·시간 제한), 앱(인박스·임무·실행 기록·설정) | mock 모델로 제안이 인박스에 쌓이고, 쓰기 도구·허용 안 된 bash가 막히고, 앱을 닫아도 시간표대로 도는지 |
| | **구현 메모 (M1 완료)**: 실제 Pi 1.3.0 계약 테스트(`packages/mate-runner/test/real-pi.test.ts`)와 dev:mock 앱에서 확인했다. 확인한 것: 템플릿으로 임무 만들기, 지금 실행, 제안(근거 Markdown)·보고 결과가 인박스에 쌓임, `rm` 요청이 "읽기 전용 허용 목록에 없음"으로 막히고 파일은 그대로, 앱을 닫은 동안 daily 임무가 시간표대로 실행되어 다시 열었을 때 인박스에 보임. "지금 실행"은 하루 상한에 세지 않는다. 설치본 묶음(extraResources의 mate-runner·mate-kit)과 `mate-v*` 릴리스는 아직 없음 | |
| M2 | 파일·git·폴링 계기, 실행당 비용 상한, 실행 세션 보기 | |
| M3 | `act`: worktree 실행, 승인 대기 → 받아들이면 적용, 로그인 시 실행기 시작, 설치본·`mate-v*` 릴리스 | 승인 전에는 작업 폴더가 그대로 |
| M4 | 템플릿(아침 브리핑·테스트 감시·CI 대응·의존성), 임무별 기억 | 같은 문제를 두 번 알리지 않음 |
| M5 | 실시간 알림(트레이·휴대폰 푸시), SSH 호스트에서 실행 | |

## 참고

- [Meta debuts Muse, its long-planned personal AI agent (Axios)](https://axios.com/2026/09/08/meta-debuts-muse-personal-ai-agent)
- [Meta introduces Muse as a proactive personal agent (TestingCatalog)](https://www.testingcatalog.com/meta-introduces-muse-as-a-proactive-personal-agent/)
- [OpenAI launches Dots, always-on AI agents (SiliconANGLE)](https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/)
- [OpenAI Dots explained (eesel)](https://www.eesel.ai/blog/openai-dots)
- [Anthropic opens Claude Duet research preview (Let's Data Science)](https://letsdatascience.com/news/anthropic-opens-claude-duet-research-preview-for-proactive-a-16522f5d)
- [Claude Duet (Inside, 승인 게이트 관련)](https://www.inside.com.tw/article/42702-anthropic-claude-duet-proactive-ai-agent)
