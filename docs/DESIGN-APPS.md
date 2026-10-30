# 세 앱의 역할과 데이터 경계 — 설계 문서 (v0.1)

> 관련 문서: [Pi Desktop 설계](DESIGN.md), [Pi Desktop Agent 설계](DESIGN-AGENT.md), [Pi Desktop Mate 설계](DESIGN-MATE.md), [개발 방식](CONTRIBUTING.md)

이 저장소의 세 앱은 같은 Pi를 엔진으로 쓰지만 하는 일이 다르다. 이 문서는 세 앱이 **무엇을 함께 쓰고 무엇을 나누는지**,
그리고 **어디서 도는지**를 정한다. 각 앱의 설계 문서가 이 문서와 어긋나면 이 문서를 따른다.

---

## 1. 역할

| 앱 | 컨셉 | 데이터의 성격 |
|---|---|---|
| **Pi Desktop** | **Pi를 GUI로 쓰는 앱.** 설치된 Pi를 그대로 보여 주고 다룬다 | 놀이터(playground). Pi의 기본 폴더를 그대로 쓰므로 터미널 `pi`와 같은 세션·스킬·설정을 본다 |
| **Pi Desktop Agent** | **혼자 독립적으로 쓰는 커스텀 Pi 하나.** Pi에 승인·기억·스킬·작업을 얹은 개인 에이전트 | 개인화된 데이터. Pi Desktop·터미널 `pi`와 섞이지 않는다 |
| **Pi Desktop Mate** | **개인화된 데이터를 능동적으로 처리하는 Pi 기반 비서.** 묻기 전에 살펴보고 알리고, 허락을 받아 처리한다 | 자기 데이터(임무·실행·대화·인박스). 사용자가 Pi로 한 일은 **읽기만** 한다 (§3.3) |

## 2. 원칙

1. **Pi 자체는 함께 쓴다.** 한 호스트의 Pi 설치본, 로그인(`auth.json`), 모델·프로바이더 설정(`models.json`, `settings.json`의 기본 모델 등), 프로젝트 신뢰(`trust.json`)는 세 앱이 같이 쓴다. 로그인과 모델 관리는 Pi Desktop이 맡는다. 한 번 로그인하면 세 앱 모두 쓴다.
2. **데이터는 함께 쓰지 않는다.** 세션, 스킬, 프롬프트, 확장, MCP 서버, 사용자 지침(`AGENTS.md`), 기억, 권한 규칙, 작업, 휴지통·아카이브는 앱마다 따로 둔다. 한 앱의 데이터가 다른 앱의 목록·문맥에 끼어들지 않는다.
3. **다른 앱의 데이터는 쓰지 않는다.** 읽는 경우는 Mate의 활동 관찰(§3.3) 하나뿐이고, 그것도 사용자가 켰을 때만 읽기만 한다.
4. **앱은 클라이언트다.** 실제로 도는 곳은 Pi가 설치된 호스트(로컬·WSL·SSH)다. 데이터도 그 호스트에 있다. 앱은 그 호스트의 데몬·실행기와 메시지만 주고받고, 호스트의 파일을 직접 읽지 않는다 (§4).

## 3. 데이터 위치 (호스트마다)

`~`는 Pi가 도는 호스트의 홈이다. 로컬이면 이 PC, WSL·SSH면 그 호스트다.

| 무엇 | Pi Desktop | Agent | Mate |
|---|---|---|---|
| Pi 설치본 | 함께 씀 | 함께 씀 | 함께 씀 |
| 로그인·모델·설정·신뢰 | `~/.pi/agent/` (함께 씀) | 같은 곳 | 같은 곳 |
| 세션(대화 기록) | `~/.pi/agent/sessions/` (Pi 기본, 터미널 `pi`와 같음) | `~/.pi-desktop-agent/sessions/` | `~/.pi-desktop-mate/sessions/`, `chat/sessions/` |
| 스킬·프롬프트 | `~/.pi/agent/skills`, `prompts` | `~/.pi-desktop-agent/skills`, `prompts` | 쓰지 않음 |
| 확장·Pi 패키지 | Pi 설정 그대로 (`settings.json`의 `packages` 포함) | agent-kit만 | mate-kit만 |
| MCP 서버 | `~/.pi/agent/mcp.json` | `~/.pi-desktop-agent/mcp.json` | 쓰지 않음 |
| 사용자 지침 `AGENTS.md` | `~/.pi/agent/AGENTS.md` | `~/.pi-desktop-agent/AGENTS.md` | 쓰지 않음 (임무 지시가 그 역할) |
| 작업 폴더의 `AGENTS.md`·`CLAUDE.md` | 읽음 | 읽음 | 읽음 (그 폴더의 것이지 앱의 것이 아님) |
| 앱 데이터 (기억·권한·작업·예약·피어·사용량 등) | `~/.pi-desktop/` | `~/.pi-desktop-agent/data/` | `~/.pi-desktop-mate/` |
| 휴지통 | `~/.pi-desktop/session-trash/` | `~/.pi-desktop-agent/session-trash/` | `~/.pi-desktop-mate/trash/` |
| 아카이브 | `~/.pi-desktop/archive.json` | `~/.pi-desktop-agent/archive.json` | `~/.pi-desktop-mate/archive.json` |
| 데몬·실행기 런타임 | `~/.pi-desktop/run/` | `~/.pi-desktop-agent/run/` | `~/.pi-desktop-mate/run/` |

### 3.1 Agent·Mate가 Pi를 띄우는 방법

Pi의 설정 폴더(`PI_CODING_AGENT_DIR`)는 바꾸지 않는다. 바꾸면 로그인·모델까지 갈라진다.
링크(심볼릭·하드)로 `auth.json`만 묶는 방법도 쓰지 않는다. Pi Desktop의 데몬이 임시 파일을 쓴 뒤 이름을 바꾸는 방식으로 저장하므로 링크가 끊어진다.
대신 Pi를 띄울 때 **데이터가 들어오는 길만 바꾼다** (Pi CLI 옵션, Pi docs/cli.md):

| 옵션 | 효과 |
|---|---|
| `--session-dir <앱 홈>/sessions` | 세션을 앱 폴더에 쓴다 |
| `-ns --skill <앱 홈>/skills` | Pi 기본 폴더·Pi 패키지의 스킬을 끄고 앱의 스킬만 올린다 |
| `-np --prompt-template <앱 홈>/prompts` | 프롬프트 템플릿도 같은 방식 |
| `-ne -e <kit 확장들> -e builtin:codemode -e builtin:tool-search` | Pi 기본·패키지 확장을 끄고 앱의 확장만 올린다. 내장 MCP(`builtin:mcp`)는 올리지 않는다 |
| `-nc` | Pi의 문맥 파일 찾기를 끈다. 사용자 수준 `~/.pi/agent/AGENTS.md`가 끼어들지 않게 하기 위해서다 |

- **MCP**: Pi의 내장 MCP는 Pi 설정 폴더의 `mcp.json`만 읽는다(`loadMcpConfig({ agentDir })`). 그래서 Agent는 Pi SDK의 `createMcpExtension({ loadConfig, credentials, logPath })`로 **자기 `mcp.json`을 읽는 MCP 확장**을 agent-kit에 둔다. MCP 서버 로그인 정보(`mcp-auth.json`)와 로그도 앱 홈에 둔다.
- **문맥 파일**: `-nc`로 끈 대신, kit 확장이 Pi와 같은 규칙(작업 폴더에서 위로 올라가며 `AGENTS.md`·`CLAUDE.md`)으로 작업 폴더의 파일을 찾고, 앱 홈의 `AGENTS.md`를 더해 시스템 안내에 붙인다. 작업 폴더의 파일은 프로젝트 신뢰를 따른다.
- **Pi Desktop**은 위 옵션을 쓰지 않는다. Pi를 있는 그대로 보여 주는 것이 컨셉이기 때문이다.

### 3.2 휴지통·아카이브

- **휴지통**: 지운 세션(Mate는 실행 기록·대화·임무)을 바로 지우지 않고 앱 홈의 휴지통으로 옮긴다. 원래 자리를 함께 적어 되살릴 수 있다. "비우기"를 해야 정말 지운다. 앱마다 따로다.
- **아카이브**: 파일은 그대로 두고 앱 목록에서만 숨긴다. 아카이브 화면에서 보고 되돌린다. Pi Desktop에서 아카이브해도 터미널 `pi`의 `/resume`에는 계속 보인다 (Pi의 파일을 옮기지 않으므로 분기·이어 열기가 깨지지 않는다).
- Pi Desktop·Agent는 데몬이 맡는다 (WSL·SSH에서도 같은 코드). Mate는 실행기가 맡는다.

### 3.3 Mate의 활동 관찰

사용자가 켰을 때만, 같은 호스트에서 **Pi Desktop·터미널 `pi`의 세션(`~/.pi/agent/sessions`)과 Agent의 세션(`~/.pi-desktop-agent/sessions`)을 읽기만** 한다.
요약(요청 앞부분, 고친 파일, 명령, 오류)만 Mate 홈에 남기고, 그 세션 파일을 옮기거나 고치지 않는다.

## 4. 어디서 도는가 — 클라이언트와 호스트

```
앱(클라이언트, 이 PC) ──메시지──▶ 호스트(로컬·WSL·SSH)
                                  ├ Pi Desktop: host-agent 데몬(~/.pi-desktop) → pi --mode rpc
                                  ├ Agent:      host-agent 데몬(~/.pi-desktop-agent) → pi --mode rpc -e agent-kit
                                  └ Mate:       mate-runner(~/.pi-desktop-mate) → pi --mode json -e mate-kit
```

| 앱 | 지금 | 바꿀 것 |
|---|---|---|
| Pi Desktop | 이미 이 구조다. 호스트마다 데몬을 띄우고 메시지로만 다룬다 (DESIGN.md §3.2~3.4) | 없음 |
| Agent | 대화·지난 대화·닫기는 데몬을 거친다. 하지만 로컬 데몬 하나뿐이고, 기억·권한·작업·예약·네트워크·사용량·스킬·MCP 등 10여 화면은 앱이 이 PC의 파일을 직접 읽는다 | ① Pi Desktop의 호스트 연결(로컬·WSL·SSH 고르기, 원격 배포)을 가져온다. 원격 데몬 홈을 `~/.pi-desktop-agent`로 띄우게 한다. ② agent-kit을 그 호스트에 올리고 `-e` 경로를 그 호스트 기준으로 바꾼다. ③ 앱이 직접 읽던 데이터를 데몬 명령으로 옮긴다 (agent 데이터 전용 메서드). ④ 스케줄러 세션은 호스트마다 하나 |
| Mate | 앱과 실행기가 이 PC의 같은 폴더 파일로 주고받는다. 데몬을 쓰지 않는다 | ① 실행기를 호스트에 올리고 띄운다 (Pi Desktop의 원격 배포 방식 재사용). ② 앱 ↔ 실행기 통신을 파일 감시 대신 **실행기의 JSON-RPC**로 바꾼다 (host-agent의 `connect`처럼 stdio로 이어 WSL·SSH에서도 같은 경로). ③ 활동 관찰·작업 공간(worktree)·텔레그램은 그 호스트에서 돈다 |

## 5. 지금 데이터를 어떻게 하나

지금까지 Agent와 Mate에서 나눈 대화는 모두 시험용이었으므로 **옮기지 않는다.**

- Agent는 새 폴더(`~/.pi-desktop-agent/sessions`, `data/` 등)에서 빈 상태로 시작한다. 예전 Agent 대화는 `~/.pi/agent/sessions`에 남아 Pi Desktop 기록에 보인다. 필요 없으면 Pi Desktop의 휴지통으로 지운다.
- 예전 agent-kit 상태(`~/.pi/agent/pi-desktop-agent/`)와 Pi 기본 폴더의 Agent용 스킬·MCP 설정은 읽지 않는다. 앱이 지우지도 않는다 (사용자의 파일이므로).

## 6. 단계

| 단계 | 내용 | 비고 |
|---|---|---|
| **D1 데이터 분리** | Agent: 세션·스킬·프롬프트·MCP·AGENTS.md·앱 데이터를 앱 홈으로, §3.1의 실행 옵션, agent-kit MCP 확장과 문맥 파일 확장. Mate: §3.1의 실행 옵션, 관찰 대상에 Agent 세션 추가 | 지금 바로. 로컬에서도 데이터가 섞이는 문제를 먼저 막는다 |
| **D2 휴지통·아카이브** | Pi Desktop·Agent: 데몬에 휴지통 목록·되살리기·비우기, 아카이브·되돌리기. 지금 삭제가 남긴 백업도 휴지통에 보인다. Mate: 실행 기록·지난 대화·임무 (200개 넘는 실행 기록 정리도 휴지통을 거침) | D1 뒤 |
| **D3 Agent 호스트 선택** | 호스트 연결을 가져와 대화·지난 대화·휴지통·아카이브를 WSL·SSH에서 쓴다 | 데몬을 거치는 기능만 |
| **D4 Agent 화면의 데몬 이전** | 앱이 직접 읽던 화면을 데몬 명령으로 하나씩 옮긴다. 다 옮기면 원격에서 모든 화면이 된다 | 여러 PR |
| **D5 Mate 원격 실행기** | 실행기 배포·JSON-RPC 통신·원격 관찰. 세부 설계를 먼저 쓴다 | 가장 큼 |
