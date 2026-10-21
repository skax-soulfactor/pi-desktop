# Pi Desktop — 설계 문서 (v0.33)

> 목표: **Pi를 포크하지 않고**, 사용자가 설치한 `pi` 그대로(업데이트 계속 받으며) 위에 GUI를 얹는다.
> 기준 버전: `@earendil-works/pi-coding-agent` 1.3.0 (2026-10). ※ 구 패키지명 `@mariozechner/pi-coding-agent`는 0.73.1에서 멈춰 있음.

## 0. 확정된 결정 (v0.2)

| 항목 | 결정 |
|---|---|
| Pi 연결 방식 | **RPC 자식 프로세스** (`pi --mode rpc`). SDK는 메타데이터 조회와 Playground에만 사용 |
| 셸 | **Electron** |
| 최우선 완성 영역 | **채팅 (TUI 대체)** |
| 지원할 사용 패턴 | 여러 프로젝트 동시 작업 · TUI와 병행 사용 · **WSL 안의 Pi** · **원격(SSH) Pi** |
| 추가 기능 | **Pi 설치/업데이트/제거 관리** · **커뮤니티 리소스(패키지·스킬·프롬프트·확장) 검색 및 설치/제거** |
| 원격 작업 수명 | **GUI를 닫아도 원격 작업은 계속 실행**한다. GUI를 다시 열면 기존 세션에 다시 붙어 그대로 이어서 작업한다 (§3.4) |
| 커뮤니티 검색 소스 | **npm `pi-package` 키워드 검색**을 사용한다. pi.dev 갤러리는 공개 API가 없다(`/api/packages` → 501) |
| 저장소 관리 | GitHub 저장소. 코드 리뷰가 가능한 단위로 커밋하고, 주석과 커밋 메시지는 한글로 쓴다 (§11) |

v0.1 대비 가장 큰 구조 변화: WSL과 SSH를 지원하기 위해 **Host Agent**(§3.2)를 도입했다. 로컬·WSL·원격을 모두 같은 코드 경로로 다룬다.
v0.3에서는 Host Agent를 **상주 데몬 + 얇은 연결기**로 나눴다(§3.4). GUI가 꺼져도 원격 작업이 살아남게 하기 위해서다.

---

## 1. 핵심 원칙

| 원칙 | 의미 |
|---|---|
| **Zero-fork** | Pi 소스를 수정하지 않는다. 공식 통합 지점(RPC 모드, SDK, 설정 파일, 확장, CLI)만 쓴다 |
| **Pi가 소유한 파일이 진실의 원천** | 설정을 GUI 자체 DB에 복제하지 않는다. `~/.pi/agent/*`, `.pi/*`, `AGENTS.md`를 직접 읽고 쓴다. 그래서 TUI와 GUI를 섞어 써도 항상 일치한다 |
| **설치된 Pi를 따라간다** | GUI 번들에 Pi를 넣지 않는다. 대상 호스트에 설치된 Pi를 찾아 실행한다. `pi update` 결과가 GUI에 바로 반영된다 |
| **기능 감지 > 버전 하드코딩** | `get_commands`, JSON Schema, 응답 형태로 기능을 감지한다. 모르는 이벤트와 필드는 버리지 않고 raw로 보여준다 |
| **GUI 메타데이터는 분리 보관** | 창 배치, 워크스페이스 목록, 카탈로그 캐시처럼 GUI만 쓰는 상태는 Electron `userData`에 둔다. `~/.pi`는 오염시키지 않는다 |

## 2. Pi가 제공하는 통합 지점 (문서로 확인함)

| 통합 지점 | 용도 |
|---|---|
| `pi --mode rpc` + `RpcClient` | 채팅 세션 제어: prompt / steer / follow_up / abort, set_model, thinking level, compact, bash, 세션 switch·fork·clone·get_tree, get_commands, export_html |
| RPC Extension UI 서브프로토콜 | 확장의 `ctx.ui.select/confirm/input/editor`를 네이티브 다이얼로그로, `notify/setStatus/setWidget/setTitle`을 토스트·상태바·패널로 렌더링 |
| SDK export (`DefaultResourceLoader`, `DefaultPackageManager`, `SessionManager`, `ModelRegistry`, `parseSessionEntries`, `buildSessionProjection` 등) | 리소스 목록과 진단, 세션 파싱, 모델 목록 |
| `schemas/*.schema.json` | settings / models / keybindings / theme 폼을 스키마로 자동 생성 |
| CLI: `pi install/remove/update/list/config`, `pi update [--extensions\|--models\|--all]`, `pi auth check --json` | 패키지 관리, Pi 자체 업데이트, 인증 상태 확인 |
| 공식 설치기 `https://pi.dev/install.sh` (macOS/Linux) | 관리형 설치, 재설치, 제거. 의존성이 고정되고 `pi update`로 갱신된다 |
| npm 키워드 `pi-package` + [pi.dev/packages](https://pi.dev/packages) 갤러리 | 커뮤니티 패키지 검색 |

**한계와 보완책**
- RPC에 `reload` 명령이 없다. → §5.3의 bridge 확장으로 `ctx.reload()`를 호출한다.
- `/login`은 TUI 전용이다. → API 키는 GUI 폼으로 받고, OAuth는 내장 터미널(§4.7)로 처리한다.
- 세션 파일에 잠금이 문서화되어 있지 않다. → GUI가 세션 소유권(lease)을 관리한다(§5.4).
- RPC 모드에서는 `ctx.ui.custom()`, footer/header, 테마 전환 같은 TUI 전용 기능이 동작하지 않는다. → 해당 확장에 "TUI 전용" 배지를 달고, 필요하면 내장 터미널로 연다.

## 3. 아키텍처

### 3.1 전체 구조

```
┌──────────────────────────────── Electron App ─────────────────────────────────┐
│ Renderer (React) — 창마다 워크스페이스 탭                                     │
│  Chat · Sessions · Context · Prompts · Skills · Extensions · Marketplace ·    │
│  Providers · Settings · Pi Manager · Playground · Inspector · Terminal(xterm) │
│                    ▲ typed IPC (contextBridge + zod)                          │
├────────────────────┼──────────────────────────────────────────────────────────┤
│ Main process                                                                  │
│  HostManager ── HostConnection(local) ─┐                                      │
│              ├─ HostConnection(wsl:Ubuntu) ─┤   한 연결 = Host Agent 1개      │
│              └─ HostConnection(ssh:devbox) ─┘   (멀티플렉스 JSON-RPC 채널)    │
│  WorkspaceManager · CatalogService · LeaseManager · Telemetry(local only)     │
└────────┬──────────────────────┬───────────────────────────┬───────────────────┘
         │ stdio                │ wsl.exe -d <distro> --    │ ssh <host> (ControlMaster)
   node host-agent.js      node host-agent.js           node ~/.pi-desktop/host-agent.js
         │                      │                           │
   ┌─────┴───────── 각 호스트에서 동일하게 동작 ────────────────────────┐
   │ Host Agent: fs(read/write/list/stat/watch) · exec · pty ·           │
   │   pi 프로세스 풀(pi --mode rpc, 세션별) · SDK facade(설치본 import) │
   └─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Host Agent — 로컬/WSL/SSH를 하나로

GUI가 Pi와 직접 대화하지 않고, **대상 호스트에서 도는 작은 Node 프로그램(Host Agent)**을 거친다.

**왜 필요한가**
- WSL이나 원격의 Pi는 **그 호스트의 파일**(`~/.pi/agent`, 프로젝트의 `.pi`)과 **그 호스트의 Node**로 동작한다. SDK import, 파일 감시, `pi install`을 전부 그 호스트 안에서 해야 한다.
- 호스트마다 다른 코드를 쓰는 대신 Agent 하나를 배포하면 로컬·WSL·SSH 모두 **같은 프로토콜**이 된다. 로컬도 같은 Agent를 자식 프로세스로 띄운다.

**프로토콜** (stdio 위의 JSON-RPC 2.0, 채널 멀티플렉싱)

| 네임스페이스 | 메서드 예시 |
|---|---|
| `host.*` | `info`(OS, arch, node 버전, 홈 경로), `ping` |
| `fs.*` | `read`, `write`(원자적: tmp 파일 → rename), `list`, `stat`, `watch`/`unwatch`, `mkdir`, `remove`(휴지통 폴더로 이동) |
| `proc.*` | `exec`(출력 스트리밍), `spawn`, `kill` |
| `pty.*` | `open`, `write`, `resize`, `close` (node-pty. 설치기·OAuth 로그인·TUI 폴백용) |
| `pi.*` | `locate`, `version`, `rpc.open(cwd, sessionFile?)` → 채널 ID, `rpc.send`, `rpc.close` |
| `session.*` | `list`(데몬이 소유한 살아 있는 세션), `attach(sessionId, lastSeq)`, `detach`, `claimWriter`, `pendingUi` (§3.4) |
| `daemon.*` | `status`, `shutdown`, `upgrade` |
| `sdk.*` | `resources(cwd)`, `contextFiles(cwd)`, `effectiveSystemPrompt(cwd)`, `listSessions(cwd)`, `models()` |

**배포와 부트스트랩**
1. 연결 전에 Agent가 없을 수 있으므로, 먼저 **plain shell exec**(`wsl.exe -- sh -c …`, `ssh host …`)로 `node --version`과 Agent 버전을 확인한다.
2. Agent는 의존성 없는 단일 번들(esbuild)로 만든다. `node-pty`처럼 네이티브 모듈이 필요한 pty 기능은 선택 사항으로 두고, 없으면 `script`/`python pty`로 대체하거나 해당 기능만 비활성화한다.
3. 버전이 다르면 `~/.pi-desktop/host-agent-<ver>.js`로 업로드한다(SSH는 stdin 파이프 또는 sftp, WSL은 `\\wsl$` 경로).
4. Node가 없으면 Pi 설치 마법사(§4.9)로 연결한다.

**전송 계층**

| 종류 | 실행 방법 | 비고 |
|---|---|---|
| Local | `child_process.spawn(process.execPath 또는 시스템 node, [agent])` | Electron 내장 Node와 시스템 Node 중 Pi가 쓰는 쪽을 사용 |
| WSL | `wsl.exe -d <distro> --cd <linux-path> -- node <agent>` | 배포판 목록은 `wsl.exe -l -q`. 경로는 `/mnt/c/...`와 `C:\...` 사이를 변환 |
| SSH | 시스템 `ssh`(ControlMaster로 연결 재사용) 또는 `ssh2` 라이브러리 | `~/.ssh/config`의 호스트 목록을 가져온다. 키·에이전트 인증은 OS ssh에 맡기고 **비밀번호는 저장하지 않는다** |

**연결 끊김**: §3.4의 상주 데몬 구조로 처리한다. 연결이 끊겨도 Pi 프로세스는 데몬 아래에서 계속 돌고, 다시 연결하면 놓친 이벤트를 재생한다.

### 3.3 워크스페이스 모델 (여러 프로젝트 동시 작업)

```
Workspace = { id, hostId, cwd, title, pinned, lastSessionFile, layout }
```
- 창 하나에 워크스페이스 탭 여러 개. 탭을 끌어 새 창으로 분리할 수 있다.
- 워크스페이스마다 열린 세션이 여러 개일 수 있고, **세션 하나 = RPC 프로세스 하나**다. 비활성 세션은 유휴 타임아웃 뒤 프로세스를 종료하고, 다시 열 때 `sessionFile`로 재개한다. 메모리를 아끼기 위해서다.
- 사이드바 "Activity"에서 모든 워크스페이스의 실행 중·대기 중·입력 필요(확장 다이얼로그) 상태를 한눈에 본다. 백그라운드 세션이 끝나거나 입력을 기다리면 OS 알림을 보낸다.
- 워크스페이스 목록은 GUI 메타데이터로 `userData`에 저장한다.

**구현 메모 (M1, v0.9)**
- 지금은 창 하나에 탭 여러 개까지 구현했다. 탭을 끌어 새 창으로 분리하기, 고정(pinned)은 후속 작업이다.
- 활동 패널(v0.17): 사이드바 대신 탭 바 오른쪽 "활동" 버튼으로 연다. 탭들이 연결한 호스트의 세션을 입력 필요 → 작업 중 → 대기 → 종료 순으로 보여주고, 누르면 보는 탭으로 가거나 새 탭으로 연다. 데몬 세션 요약에 `busy`(agent_start~agent_settled)와 `title`(이름 또는 첫 질문)을 두었다. 데몬은 붙어 있지 않은 세션의 이벤트를 보내지 않으므로 3초마다 목록을 다시 읽는다.
- 탭 하나 = 렌더러의 `Workspace` 하나. 숨긴 탭도 언마운트하지 않아 호스트 연결·세션 구독·확장 UI 상태를 그대로 유지한다.
- 탭 목록과 활성 탭, 탭별 호스트·마지막 세션은 렌더러 `localStorage`에 저장한다 (`pi-desktop.tabs`, `pi-desktop.tab.<id>.*`). 첫 탭은 기존 키를 그대로 써서 이전 설정이 이어진다. 탭을 닫으면 그 탭의 키를 지우고, Pi 세션은 데몬에서 계속 돈다.
- 새 탭은 지금 탭의 호스트로 시작하고 최근 세션을 자동으로 열지 않는다.
- 숨긴 탭이 실행 중→끝남이 되면 "완료", 확장 다이얼로그·끼어들기·열기 선택이 생기면 "입력 필요"를 탭에 표시하고 OS 알림을 띄운다. 탭을 열면 표시를 지운다.
- 같은 세션을 두 탭에서 열 수 있다. main 프로세스는 attach 중에도 실시간 이벤트를 모든 탭에 보내고, attach 결과의 재생 이벤트와는 seq로 중복을 거른다.

### 3.4 상주 세션 — GUI를 닫아도 작업은 계속된다 (v0.3 신규)

**요구사항**
- 원격(SSH) 작업은 GUI를 닫거나 네트워크가 끊겨도 계속 실행된다.
- GUI를 다시 열면 기존 세션에 다시 붙는다. 그동안 진행된 대화, 툴 실행, 대기 중인 확장 다이얼로그를 그대로 보고 이어서 작업한다.

**구조: Host Agent를 둘로 나눈다**

```
GUI ──ssh──▶ host-agent connect ──unix socket──▶ host-agentd (상주 데몬)
             (얇은 연결기: stdio ↔ 소켓 중계)        ├ pi --mode rpc  (세션 A)
             GUI가 꺼지면 함께 종료                   ├ pi --mode rpc  (세션 B)
                                                     └ 세션별 이벤트 저널
```

| 구성 요소 | 역할 | 수명 |
|---|---|---|
| `host-agentd` (데몬) | Pi RPC 프로세스 소유, 이벤트 저널 기록, fs/proc 처리 | SSH 연결과 무관하게 계속 실행 (`setsid`/`nohup`으로 분리 실행, 선택적으로 `systemd --user` 유닛) |
| `host-agent connect` (연결기) | SSH stdio와 데몬의 unix socket을 이어주기만 함. 데몬이 없으면 띄운 뒤 연결 | SSH 세션과 같이 죽음 |

- 소켓 위치: `~/.pi-desktop/run/agentd.sock`, 권한 `0600`. 같은 사용자만 접근할 수 있다.
- 데몬은 호스트당 1개, 사용자당 1개다. 이미 떠 있으면 연결기는 그 데몬에 붙는다.
- Windows에서는 연결기가 데몬을 **WMI(`Win32_Process.Create`)로** 띄운다. 직접 spawn이나 `cmd start`로 띄우면 앱(Electron)의 상속 가능한 핸들이 데몬까지 넘어가, 앱을 닫아도 그 자원이 풀리지 않는 것을 실험으로 확인했다(v0.6). WMI는 환경 변수를 통째로 대체하므로 연결기 환경 전체를 표준 입력으로 넘긴다.
- 데몬 버전이 새 GUI와 맞지 않으면, 실행 중인 세션이 없을 때만 교체한다. 세션이 있으면 기존 데몬을 유지하고 GUI에 "작업이 끝나면 업데이트" 배지를 띄운다.
- **구현 메모: 예전 데몬 교체 (M3, v0.27)**
  - 버전 번호 대신 **빌드 식별자**(번들 파일 SHA-256의 앞 12자리)로 비교한다. 버전이 같아도 번들이 바뀐 경우(개발 중 다시 빌드, 같은 버전으로 다시 배포)를 가리기 위해서다. WSL에 올리는 파일 이름의 해시와 같은 값이다.
  - 데몬은 시작할 때 자기 번들을 해시해 `host.info`·`daemon.status`의 `agentBuild`로 알린다. 이 필드가 없으면 예전 데몬으로 본다.
  - 앱은 연결할 때마다 자기 번들(로컬은 그 파일, WSL은 올린 파일)의 식별자와 비교한다. 다르면 `daemon.status`로 실행 중인 세션을 센다.
    - 세션이 없으면 `daemon.shutdown`을 보내고, 연결기가 끝나면 곧바로 다시 붙는다. 이때 연결기가 새 번들로 데몬을 띄운다. 오류 안내 없이 "연결 중"으로만 보인다.
    - 세션이 있으면 그대로 붙고 "Agent 업데이트 대기" 배지를 띄운다. 30초마다 세션 수를 다시 보고, 모두 끝나면 바꾼다. 배지를 누르면 "세션이 끝나면 바꾸기"(기본)와 "지금 바꾸기"(실행 중인 세션이 끝나고, 세션 파일로 "다시 열기")를 고를 수 있다.
    - 같은 번들로 한 번 바꿨는데도 다시 예전 데몬이 붙으면 되풀이하지 않고 배지만 띄운다.
  - 연결기는 지금처럼 바이트만 중계한다. 판단을 앱에 둔 이유는 사용자에게 묻는 화면이 앱에 있고, SSH에서도 같은 코드로 쓸 수 있기 때문이다.

**세션 이벤트 저널과 재연결**
1. 데몬은 세션마다 Pi가 보낸 모든 RPC 이벤트에 **순번(seq)**을 붙여 저널에 쌓는다. 저널은 **메모리 링버퍼**다 (v0.6: 디스크 저널은 두지 않기로 함, 아래 4번).
2. GUI는 세션별로 마지막으로 받은 `seq`를 기억한다.
3. 다시 연결하면 `session.attach(sessionId, lastSeq)`를 호출한다.
   - 저널에 그 뒤의 이벤트가 남아 있으면 **빠짐없이 재생**한 다음 실시간 스트림으로 이어간다.
   - 너무 오래되어 저널에서 잘렸으면 **스냅샷 복구**를 한다. `get_messages`, `get_state`, `get_tree`로 현재 상태를 통째로 받아 화면을 다시 그린 뒤 실시간 스트림을 붙인다.
4. 저널은 Pi의 세션 파일을 대신하지 않는다. 대화의 진짜 기록은 Pi의 세션 JSONL이고, 저널은 **스트리밍 중간 상태**(진행 중인 메시지 델타, 툴 실행 출력)를 잃지 않기 위한 보조 장치다.
   - **디스크 저널을 두지 않는 이유 (v0.6 결정)**: 데몬이 죽으면 그 아래 Pi 프로세스도 stdin이 닫혀 함께 끝난다. 디스크에 남긴 중간 상태로는 대화를 이어 갈 수 없고, 이어 가려면 어차피 Pi 세션 파일로 다시 열어야 한다. 그래서 데몬 재시작은 "세션 파일로 다시 열기 + `get_messages` 스냅샷"으로 복구한다.
   - 링버퍼에서 잘린 구간을 요청받으면 앱은 같은 스냅샷 방식으로 화면을 다시 만든다.

**GUI가 없는 동안 생기는 일**

| 상황 | 동작 |
|---|---|
| 에이전트가 계속 작업 | 그대로 진행한다. 결과는 세션 파일과 저널에 쌓인다 |
| 확장이 다이얼로그를 띄움 (`select`/`confirm` 등) | 데몬이 요청을 **보류 목록**에 보관한다. 다시 연결하면 GUI가 바로 띄운다. 확장이 timeout을 지정했다면 Pi가 기본값으로 자동 처리하고, 그 사실을 GUI에 알린다 |
| Steer / Follow-up 큐 | Pi 프로세스 안에 그대로 남아 있다 |
| Pi 프로세스가 죽음 | 데몬이 감지해 앱에 알린다. 앱은 대화를 화면에 남긴 채 입력을 잠그고 "다시 열기"를 보여준다 (`sessionFile`로 재시작 후 스냅샷 복구) |
| 데몬이 죽음 (재시작) | Pi도 함께 끝난다. 앱은 새 데몬에 재연결한 뒤 보던 세션이 없으면 같은 방식으로 "다시 열기"를 보여준다 |
| 원격 서버 재부팅 | 데몬과 진행 중이던 턴은 사라진다. 세션 파일은 남아 있으므로 마지막 확정 지점부터 재개할 수 있다 |

**GUI를 다시 열었을 때의 화면**
- 시작하면 등록된 모든 호스트에 연결해 `sessions.list`로 **살아 있는 세션 목록**을 가져온다. Activity 사이드바에 실행 중·완료·입력 대기 상태로 표시한다.
- GUI가 꺼져 있던 동안 끝난 작업에는 "새 결과" 배지를 단다.
- 워크스페이스 탭과 창 배치는 `userData`에 저장해 두었다가 그대로 복원한다.

**여러 GUI가 같은 세션에 붙을 때** (예: 노트북과 데스크톱)
- 한 세션에 **입력 권한(writer)을 가진 클라이언트는 하나**다. 나머지는 읽기 전용으로 실시간 스트림을 본다.
- 읽기 전용 쪽에서 "제어 가져오기"를 누르면 기존 writer에게 알린 뒤 권한을 넘긴다.
- **구현 메모 (M3, v0.29)**
  - 단위는 데몬 연결 하나(= 앱 하나)다. 한 앱의 여러 탭은 연결을 함께 쓰므로 같은 권한을 가진다.
  - 권한을 얻는 경우: 세션을 연 앱, 또는 권한이 빈 세션에 붙거나(attach) 먼저 입력한 앱.
  - 권한이 없는 앱이 바꾸는 명령(prompt, abort, 모델 변경, 확장 다이얼로그 답 등)이나 `session.close`를 보내면 `NotWriter`(-32012)로 거부한다. `get_*` 조회와 `export_html`은 읽기 전용 앱도 보낼 수 있다.
  - `session.claimWriter`로 권한을 가져온다. 권한이 바뀌면 붙어 있는 앱마다 자기 기준 값(`you`·`other`·`none`)을 `session.writerChanged`로 알리고, attach 결과에도 담는다.
  - 권한을 가진 앱이 끊기면(앱 종료, 네트워크) 권한을 비운다. 남은 앱은 입력창이 바로 풀리고, 먼저 입력하는 쪽이 가져간다.
  - 앱은 `other`일 때 입력창·세션 바를 잠그고 "다른 앱이 조작 중" 안내와 "제어 가져오기" 버튼을 보여준다. 대화는 계속 실시간으로 보인다.
  - 확인: 같은 데몬에 붙는 두 번째 연결로 다른 PC의 앱을 흉내 냈다. 그 연결이 제어를 가져가 보낸 질문과 답이 앱에 실시간으로 보였고, 앱에서 다시 가져오자 그 연결의 입력이 거부되었다.

**호스트별 기본값**

| 호스트 | GUI 종료 시 기본 동작 | 비고 |
|---|---|---|
| SSH 원격 | **계속 실행** (요청 사항) | |
| WSL | 계속 실행 | WSL은 클라이언트 프로세스가 모두 끝나면 배포판을 멈출 수 있다. M3 스파이크에서 데몬이 살아남는지 확인하고, 안 되면 `systemd` 사용 또는 keep-alive 방식을 적용한다 |
| 로컬 | 실행 중인 세션이 있으면 **물어본다** ("백그라운드에서 계속" / "모두 중지") | 같은 데몬 구조라서 기술적으로는 원격과 똑같이 동작한다 |

**데몬 정리 규칙**: 살아 있는 세션이 없고 연결된 GUI도 없는 상태가 설정 시간(기본 30분) 동안 이어지면 스스로 종료한다. Pi Manager 화면에서 호스트별 데몬 상태 확인과 강제 종료를 할 수 있다.

## 4. 기능 모듈

### 4.1 Chat (최우선, TUI 대체)

**목표: TUI에서 하던 모든 일을 마우스와 키보드로 더 편하게.** M1에서 이 화면의 완성도를 가장 높인다.

- **스트리밍 렌더링**: `message_update` 델타로 그리고 `message_end`로 확정본을 교체한다(json.md 규칙). 완료 판정은 `agent_end`가 아니라 `agent_settled`다.
- **사고(thinking) 블록**: 접기/펼치기, 기본 상태는 `hideThinkingBlock` 설정을 따른다.
- **툴 호출 카드**: 툴별 렌더러를 둔다.
  - `edit`/`write`: side-by-side diff, 파일 열기 버튼
  - `bash`/`powershell`: 터미널 스타일 출력, 종료 코드, 실행 시간
  - `read`/`grep`/`find`: 파일 링크와 결과 요약
  - 알 수 없는 툴(확장·MCP): 인자와 결과를 JSON 트리로
  - **구현 메모 (M1, v0.11)**
    - 표시 규칙은 `tool-view.ts`에 두고 Pi 1.3.0의 실제 결과로 테스트한다. edit는 `details.patch`(표준 unified diff)를 쓰고, patch가 없으면(실행 중, 실패) 인자의 `oldText`·`newText`로 미리보기를 그린다.
    - "파일 열기"는 실행 파일이 실행될 위험이 있어서 탐색기에서 **위치만 보여준다**(`shell.showItemInFolder`). WSL은 `\\wsl.localhost\<배포판>` 경로로 바꾼다. SSH 호스트에서는 버튼을 숨긴다.
    - 툴 호출 id를 턴마다 다시 쓰는 모델 서버가 있어서, 같은 id의 결과는 가장 최근 카드에 붙인다.
    - read·grep·find·ls의 결과 링크(클릭해서 파일 열기)는 후속 작업이다.
- **입력창**
  - 멀티라인 에디터, 히스토리(↑), 초안 자동 저장
  - `/` 자동완성: `get_commands`(프롬프트 템플릿, 스킬, 확장 커맨드)와 각 설명을 표시
  - `@` 파일 피커(Host Agent의 `fs.list`로 원격에서도 동작), 이미지 붙여넣기와 드래그 앤 드롭
  - `!` 셸 명령은 RPC `bash`로 실행
  - 스트리밍 중에는 **Steer**(현재 턴 뒤에 끼워넣기)와 **Follow-up**(실행이 끝난 뒤) 버튼을 따로 보여주고, 대기 중인 큐를 표시하고 비울 수 있다.
  - **구현 메모 (M1, v0.10)**
    - 히스토리는 최근 100개를 모든 탭이 함께 쓰고, 초안은 세션 파일별로 저장한다.
    - `!명령`은 결과를 컨텍스트에 넣고, `!!명령`은 넣지 않는다(`excludeFromContext`, TUI와 같은 규칙).
    - Pi는 RPC `bash`에 출력 조각(`bash_execution_update`)만 보내고 시작·끝 이벤트가 없다. 그래서 데몬이 `pi_desktop_bash_start`·`pi_desktop_bash_end`를 저널에 남긴다(`DaemonEvents`). 다른 탭이나 다시 연결한 앱도 같은 셸 카드를 그린다.
    - `bash`는 끝나야 응답이 오므로 데몬과 앱 모두 이 명령에는 응답 시간 제한을 두지 않는다. 셸 카드의 "멈춤"은 `abort_bash`를 보낸다.
    - 이미지 첨부(v0.16): 붙여넣기·끌어 놓기로 PNG·JPEG·GIF·WebP를 받는다(한 장 20MB, 한 번에 10장). 질문과 함께 RPC `images`로 보낸다. 크기 조정은 Pi가 모델 설정대로 하므로 하지 않는다. 이미지를 받지 않는 모델(input에 "image" 없음)이면 Pi가 이미지 대신 "(image omitted …)"를 보내므로, 첨부할 때 미리 안내한다.
    - `@` 파일 피커(v0.15): 데몬의 `fs.search`가 세션 작업 폴더에서 찾는다. git 저장소면 `git ls-files`(.gitignore 존중), 아니면 생성물 폴더를 빼고 훑는다. 목록은 10초 캐시한다. 고르면 `@경로`만 넣는다. Pi RPC는 프롬프트 속 `@경로`를 펼치지 않으므로(TUI도 경로만 넣음) 모델이 필요하면 read 툴로 읽는다.
    - 대기 큐(v0.12): `queue_update`로 받은 Steer·Follow-up을 입력창 위에 보여준다. "비우고 입력창으로"와 "중단"은 `clear_queue`로 꺼낸 글을 입력창에 되돌린다. Pi는 `abort`만 하면 큐를 이어서 처리하므로, 중단은 큐를 먼저 꺼낸 뒤 abort한다.
- **상단 바**: 모델 선택(`get_available_models`, 프로바이더별 그룹·검색), thinking level, 컨텍스트 사용량 게이지(`get_session_stats`), 비용, Compact 버튼, 자동 컴팩션 토글
  - **구현 메모 (M1, v0.14)**: 모델 선택은 검색창이 있는 선택기다. 최근 사용 5개(모든 탭 공통)를 맨 위에 두고 프로바이더별로 묶는다. 키보드(↑·↓·Enter·Esc)로 고를 수 있다. 목록에 없는 현재 모델(확장이 바꾼 모델)도 보인다. 자동 컴팩션 토글은 Compact 옆 "자동" 체크다(v0.18).
- **세션 사이드바**: 워크스페이스별 세션 목록과 검색, 이름 변경, HTML export, **트리 뷰(`get_tree`)에서 노드를 골라 fork/clone**
  - **구현 메모 (M1, v0.13)**: 검색은 실행 중·기록 목록을 이름·첫 메시지·폴더·파일 경로로 거른다. 이름 변경은 보고 있는 실행 중 세션만 된다(`set_session_name`에 Pi 프로세스가 필요). 기록에서 고른 세션은 열어서 바꾼다. HTML export는 세션 파일 옆에 만든다. Pi 기본 위치는 작업 폴더(사용자 저장소)이고, Pi는 없는 폴더를 만들지 않기 때문이다. 만든 파일은 로컬·WSL이면 탐색기에서 보여준다.
- **확장 UI**: select/confirm/input/editor는 모달로, timeout이 있으면 카운트다운을 보여준다. notify는 토스트, setStatus는 상태바, setWidget은 우측 패널, setTitle은 탭 제목으로.
- **재시도·오류**: 자동 재시도 진행 표시와 `abort_retry`, 오류 메시지 카드에 "다시 시도" 버튼
  - **구현 메모 (M1, v0.12)**: Pi는 재시도할 때마다 내용 없는 오류 응답을 남기므로, 재시도가 시작되면 그 응답은 화면에서 빼고 재시도 안내로 대신한다. "다시 시도"는 Pi에 해당 RPC가 없어서 **"다시 보내기"**(마지막 질문을 입력창에 채우기)로 구현했다. 바로 보내면 같은 질문이 기록에 겹쳐 쌓이기 때문이다.
- **키보드 우선**: 명령 팔레트(Ctrl+K), 단축키는 Pi `keybindings.json`의 의미를 가능한 한 따른다.
  - **구현 메모 (M1, v0.18)**: Ctrl+K 팔레트는 보이는 탭의 Workspace가 연다. 탭 명령은 App이 넘겨준다. 세션 전환, 최근 기록, 실행 제어, Compact·자동 컴팩션, 트리, 내보내기, TUI, Thinking·모델, Pi 명령을 담는다. 지금 쓸 수 없는 명령은 목록에서 뺀다. Pi `keybindings.json`을 따르는 단축키는 후속 작업이다.

### 4.2 Context & Instructions
- **AGENTS.md 계층 뷰**: agent-dir → 상위 디렉터리들 → cwd 순서로 실제 로드되는 파일을 나열한다(`sdk.contextFiles`). 각 파일을 Monaco로 편집하고, `AGENTS.override.md`가 있으면 무엇을 대체하는지 표시한다.
- `SYSTEM.md` / `APPEND_SYSTEM.md`(user/project) 편집과 **실제 적용되는 시스템 프롬프트 미리보기**

### 4.3 Prompt Templates · 4.4 Skills · 4.5 Extensions
v0.1과 같다. 목록마다 출처 배지(user / project / package 이름)를 달고, 생성 마법사, 활성/비활성 토글, 로드 진단을 제공한다. Extension Dev Mode는 저장할 때마다 자동 reload한다.

**구현 메모: 리소스 창 (M4 첫 단계, v0.30)** — 읽기 전용이다. 편집·생성·토글은 다음 단계에서 한다.
- 데몬의 `resources.list({cwd})`가 그 호스트에 설치된 Pi의 SDK로 Pi와 똑같이 찾는다.
  - 프롬프트·스킬·AGENTS.md·SYSTEM.md·APPEND_SYSTEM.md: `DefaultResourceLoader`를 `noExtensions`로 돌린다.
  - 확장·테마: 확장은 불러오는 순간 코드가 실행된다. 그래서 `DefaultPackageManager.resolve`의 경로 해석으로 목록만 얻고, 설치되지 않은 패키지는 설치하지 않고 건너뛴다. 확장 코드가 실행되지 않음을 테스트로 확인한다.
  - 설정에서 꺼 둔 프롬프트·스킬은 로더가 돌려주지 않으므로 경로 해석 결과에서 "꺼짐"으로 채운다.
  - 이름 충돌 같은 진단은 그 파일 항목에 표시한다.
- 앱: 상단의 "리소스" 버튼과 명령 팔레트 "리소스 보기"로 연다. 기준은 보고 있는 세션의 폴더, 없으면 입력창의 폴더다.
  - 탭: 컨텍스트(불러오는 순서) / 프롬프트 / 스킬 / 확장 / 패키지
  - 출처 배지(사용자·프로젝트·패키지 소스), 짧은 경로(`~agent/…`, `./…`, `../AGENTS.md`), 로컬·WSL이면 "위치 열기"
- "알 수 없는 메서드" 오류에는 상단의 "Agent 업데이트 대기"를 눌러 바꾸라는 안내를 덧붙인다. 세션이 돌고 있으면 예전 데몬을 유지하므로(§3.4) 생기는 일이며, 개발 중 실제로 만났다.

**구현 메모: 리소스 편집 (M4, v0.31)** — 마크다운 리소스(AGENTS.md·프롬프트·스킬)만 고치고 만든다. 토글과 삭제는 아직 없다.
- 데몬의 `resources.read` / `resources.write` / `resources.create`
  - 다루는 파일은 Pi가 리소스로 읽는 `.md`뿐이다. 데이터 폴더 안, 작업 폴더나 상위 폴더의 `.pi/` 안, 작업 폴더나 상위 폴더에 바로 있는 AGENTS.md·CLAUDE.md만 허용한다. `auth.json` 같은 설정은 막힌다.
  - 쓰기는 임시 파일에 쓴 뒤 바꿔치기한다(§5.7). 앱이 읽은 뒤 파일이 바뀌었으면(수정 시각 비교) 덮어쓰지 않는다.
  - 덮어쓰기 전 내용은 파일마다 하나씩 앱 홈의 `resource-backups/`에 남긴다. 처음에는 파일 옆 `.bak`으로 했으나, 사용자 저장소에 `AGENTS.md.bak`이 생겨 바꿨다.
  - 새 프롬프트·스킬은 사용자(데이터 폴더) 또는 프로젝트(`.pi/`)에 틀을 갖춰 만든다. 이름 규칙은 Pi 스킬 규칙과 같다(소문자·숫자·하이픈, 64자 이하). 이미 있으면 거부한다.
- 앱: 리소스 창 항목의 "편집"으로 편집기를 연다. 패키지에 든 것과 확장 코드는 고치지 않는다.
  - Ctrl+S로 저장한다. 거부되면 "다시 열기"로 바뀐 내용을 본다.
  - 저장하지 않고 나가려 하면 확인을 받는다.
  - 탭 위의 "새 …" 칸으로 만든다.
- 반영 시점: Pi RPC에는 다시 불러오기 명령이 없고, 확장 명령의 `ctx.reload()`로만 할 수 있다. 처음에는 "새로 여는 세션부터 반영"이라고만 안내했다. v0.32부터는 저장한 뒤 "지금 세션에 반영"으로 §5.3 bridge 확장의 `/desktop:reload`를 보낸다.

### 4.6 Marketplace (신규) — 커뮤니티 리소스 검색·설치·제거

**카탈로그 소스**는 플러그형 `CatalogProvider` 인터페이스로 만든다.

| Provider | 데이터 출처 | 설치 방식 |
|---|---|---|
| **npm** | `registry.npmjs.org/-/v1/search?text=keywords:pi-package` (다운로드 수, 최근 업데이트 포함) | `pi install npm:<name>@<ver>` |
| ~~pi.dev 갤러리~~ | 공개 API 없음(`/api/packages` → 501, 페이지는 서버 렌더링 HTML). 갤러리도 npm `pi-package` 키워드를 기준으로 하므로 npm 검색으로 충분하다. 미리보기는 `package.json`의 `pi.image`/`pi.video`를 직접 읽고, 상세 화면에 "pi.dev에서 보기" 링크만 둔다 | — |
| **GitHub 저장소** | 사용자가 등록한 저장소(기본 예시: `anthropics/skills`, `badlogic/pi-skills`). GitHub API로 `SKILL.md`, `prompts/*.md`, `package.json`의 `pi` 매니페스트를 스캔 | 패키지 형태면 `pi install git:...@<ref>`, 개별 스킬·프롬프트면 해당 폴더만 복사(§아래) |
| **URL / 로컬 경로** | 직접 입력 | `pi install <url\|path>` |

**화면**
- 검색창 + 필터(종류: extension / skill / prompt / theme, 정렬: 인기·최신, 출처)
- 상세 페이지: README 렌더링, 포함된 리소스 목록(매니페스트 분석), 버전 목록, 저장소 링크, 다운로드 수, **보안 요약**(확장 코드 포함 여부, `dependencies` 목록, 설치 스크립트 유무)
- 설치 대화상자: 범위(User / 이 프로젝트), 버전 고정 여부, **포함할 리소스 선택**(settings의 패키지 필터로 저장)
- "설치됨" 탭: `pi list` 결과, 업데이트 가능 표시(`pi update <source>`), 제거(`pi remove`), 리소스 필터 편집(`pi config`에 해당)

**개별 스킬·프롬프트 가져오기** (패키지가 아닌 단일 폴더나 파일)
- 패키지 매니저를 거치지 않고 해당 폴더(`SKILL.md` + 부속 파일)나 `.md`만 `~/.pi/agent/skills/<name>/`(또는 `.pi/skills/`)로 복사한다.
- 출처, 커밋 SHA, 파일 해시를 GUI 메타데이터(`userData/imports.json`)에 기록한다. 이를 근거로 **업데이트 확인**과 **로컬 수정 감지**(수정됐으면 덮어쓰기 전에 diff를 보여줌), **깨끗한 제거**를 한다.
- 이름이 충돌하면 이름 변경, 덮어쓰기, 취소 중에서 고르게 한다.

**보안 원칙** (Pi 문서의 권고를 그대로 반영)
- 확장이 포함된 패키지는 설치 전에 "임의 코드가 실행됩니다" 경고와 소스 링크를 보여준다.
- 프로젝트 범위 설치는 프로젝트 trust 상태를 함께 표시한다.
- 설치와 제거는 모두 활동 로그에 남긴다.

### 4.7 Providers & Models
- 프로바이더별 상태는 `pi auth check --provider X --json`으로 확인한다(ready / not_ready / invalid). **키 값은 렌더러로 보내지 않는다.**
- **API 키 등록**: GUI 폼으로 입력받아 Host Agent가 `auth.json`에 원자적으로 쓴다. 저장 후 `auth check`로 검증한다. `!command` 형식(시크릿 매니저 연동)도 지원한다.
- **OAuth 로그인**: 내장 터미널(xterm.js + `pty.open`)에서 `pi`를 띄워 `/login <provider>`를 실행한다. 원격이나 WSL에서 콜백이 닿지 않으면, Pi가 안내하는 대로 리다이렉트 URL을 붙여넣는 흐름을 그대로 쓴다.
- `models.json`은 스키마 기반 폼으로 편집한다(OpenAI 호환 엔드포인트, Ollama, llama.cpp 등). "연결 테스트" 버튼과 `pi update --models`(모델 카탈로그 새로고침)를 제공한다.

**구현 메모 (M2, v0.21)**
- 프로바이더 목록은 설치된 Pi 옆의 pi-ai `builtinProviders()`(ID·이름·API 키/OAuth 지원)에 models.json·auth.json의 프로바이더를 합친다. Pi 버전에 맞게 따라가도록 데몬 번들에 넣지 않는다.
- 상태는 `pi auth check --json`으로 확인한다. 저장된 것만 자동으로 확인하고, 나머지는 버튼으로 확인한다.
- API 키는 데몬이 auth.json에 원자적으로 쓴다(POSIX 600). 같은 항목의 `env`는 남긴다.
- 목록에는 자격 증명의 종류만 담고 키 값은 돌려주지 않는다.
- models.json 폼(v0.22)
  - 사용자 정의 프로바이더의 name·baseUrl·api·apiKey와 모델의 id·name·reasoning·이미지 입력·contextWindow·maxTokens만 다룬다. 나머지(compat, headers, modelOverrides, cost 등)는 그대로 둔다.
  - apiKey가 그대로 키 값이면 가리고, 바꾸지 않으면 유지한다.
  - 쓰기 전에 `models.json.bak`으로 백업하고, 깨진 파일은 덮어쓰지 않는다.
  - "연결 테스트"는 데몬이 그 호스트에서 `{baseUrl}/models`를 불러 모델 ID를 가져온다(WSL의 localhost가 맞게).
- OAuth 로그인은 내장 터미널에서 한다(§4.12, v0.23).

### 4.8 Settings
v0.1과 같다. 스키마 기반 폼, User/Project 탭, diff 미리보기 후 저장, 원본 JSON 편집 모드.

### 4.9 Pi Manager (신규) — 설치·업데이트·사용·제거

호스트마다(로컬, WSL 배포판, SSH 서버) 하나씩 있는 화면이다.

**상태 감지** (`pi.locate`)

| 항목 | 방법 |
|---|---|
| 설치 여부와 경로 | `command -v pi` / `where pi`, `npm root -g` |
| **설치 방식** | 관리형 설치기(`managed-install.json` 마커) / npm 전역 / Nix(`/nix/store` 경로) / 기타 |
| 버전 | `pi --version`, 최신 버전은 `npm view @earendil-works/pi-coding-agent version` |
| 전제 조건 | Node ≥ 22.19, Windows는 Git Bash(또는 `shellPath`, PowerShell 툴 설정) |
| 데이터 | `~/.pi/agent` 크기, 세션 수, 인증된 프로바이더 수 |

**구현 메모 (M2 첫 단계, v0.19)**: 읽기 전용 상태 화면부터 만들었다. 데몬의 `pi.status`가 다음을 돌려준다. 바꾸는 동작은 아직 없다.
- 찾은 Pi(경로·버전·설치 방식)
- Pi를 실행할 node와 Pi `engines.node` 충족 여부
- Git Bash(Windows, Pi와 같이 `settings.json`의 `shellPath` → Git for Windows 순)
- 세션 수·크기, 설정 파일 유무
- auth.json의 프로바이더 이름 (키 값은 보내지 않음)

최신 버전은 `pi.latest`(`npm view`, 1시간 캐시)로 조회한다. 상단 바에 Pi 버전과 "↑ 새 버전"을 표시한다. PATH 탐색, Nix 설치 감지, `~/.pi/agent` 전체 크기는 아직 없다.

**설치 마법사**

| 대상 | 기본 방법 | 대안 |
|---|---|---|
| macOS / Linux / WSL / SSH | 공식 설치기: `curl -fsSL https://pi.dev/install.sh \| sh` (스크립트 내용을 먼저 보여주고 동의를 받은 뒤 **내장 터미널에서 실행**. 설치기가 대화형 메뉴를 쓰기 때문) | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` |
| Windows 네이티브 | Node가 22.19 이상인지 확인 → 없으면 `winget install OpenJS.NodeJS.LTS` 안내(동의 후 실행) → `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` | — |
| 공통 후속 단계 | Git Bash 확인(Windows), 프로바이더 로그인(§4.7), 기본 모델 선택, 첫 워크스페이스 열기 | |

**업데이트**
- 시작할 때와 주기적으로 최신 버전을 확인하고 배지로 알린다. CHANGELOG의 해당 구간을 보여준다.
- 실행: `pi update`(Pi만) / `pi update --extensions` / `pi update --all`. Nix 설치는 `nix profile upgrade pi` 명령을 안내만 한다.
- 실행 중인 세션은 안전하게 정지(`agent_settled`까지 대기하거나 사용자 확인 후 abort)한 다음 업데이트하고, 끝나면 각 세션을 `sessionFile`로 다시 연다.
- **특정 버전 설치·롤백**: `npm i -g @earendil-works/pi-coding-agent@<ver>`. GUI 호환 범위(`supportedPi`) 밖이면 경고한다.

**구현 메모 (M2, v0.20)**
- 업데이트는 데몬의 `pi.update`가 Pi의 `pi update`를 그대로 실행한다. 대상은 self·extensions·all·models만 받는다. 설치 방식 판단은 Pi에 맡긴다. Pi는 npm 전역·관리형 설치가 아니면 스스로 거부한다.
- 거부해도 종료 코드가 0이라, 성공 여부는 실행 전·후 버전으로 판단하고 거부는 출력 문구로 알아본다. 진행 출력은 `pi.updateOutput` 알림으로 보낸다.
- 실행 중인 세션은 멈추지 않는다. 업데이트 전에 "그 세션은 지금 버전으로 계속 돌고, 새 버전을 쓰려면 다시 열어야 한다"고 알리고 확인을 받는다. 자동 정지·재시작과 특정 버전 설치·롤백은 후속 작업이다.

**구현 메모: 설치·다른 버전·제거 (M2, v0.24)**
- 앱은 명령을 몰래 실행하지 않는다. 실행할 명령을 그대로 보여주고, 확인하면 그 호스트의 내장 터미널(셸)에 입력해 눈앞에서 돈다.
- Windows는 `npm.cmd install -g --ignore-scripts`로 설치한다(PowerShell 실행 정책 때문에 npm.ps1 대신 npm.cmd). Node가 부족하면 `winget install OpenJS.NodeJS.LTS` 단계를 둔다.
- macOS·Linux·WSL은 공식 설치기를 `~/.pi-desktop/pi-install.sh`로 내려받아 `less`로 보여준 뒤 실행한다. 설치기는 대화형 메뉴(y 다시 설치 / u 제거 / n 아무것도 안 함)로 다루므로, 관리형 설치의 제거도 설치기로 한다.
- 특정 버전·롤백은 npm 전역 설치만 된다. 설치기에는 버전 옵션이 없다.
- 데이터(`~/.pi/agent`) 처리(v0.25)
  - 백업: 언제든 `<앱 홈>/backups/pi-agent-<날짜시각>.tar.gz`로 만든다(POSIX 600, Windows는 System32 tar).
  - 삭제: Pi를 제거한 뒤에만 된다(관리형 설치는 Pi가 데이터 폴더 안에 있다). 두 번 확인하고("삭제" 직접 입력), 기본은 백업 후 삭제다.
  - 데몬의 안전장치: 실행 중 세션, Pi가 그 안에 설치됨, 확인 경로 불일치, 홈·루트·얕은 경로는 거부한다. 폴더 안 링크(junction 포함)의 대상은 지우지 않는다.

**제거**
- 방식별 명령: 관리형 설치는 설치기의 uninstall 동작(내장 터미널), npm은 `npm uninstall -g @earendil-works/pi-coding-agent`, Nix는 안내만.
- 데이터 처리 선택: **유지**(기본) / **백업 후 삭제**(`~/.pi/agent`를 zip으로 보관한 뒤 삭제) / 그대로 삭제. 삭제 옵션은 두 번 확인한다. `auth.json`이 포함된다는 점을 명시한다.

**"사용"**: 호스트 카드에서 바로 "워크스페이스 열기", "터미널에서 pi 열기"(내장 xterm)를 제공한다.

### 4.10 SDK Playground · 4.11 Event Inspector
v0.1과 같다. Playground 스크립트도 Host Agent를 통해 **대상 호스트에서** 실행되므로 WSL이나 원격의 Pi SDK로 개발하고 테스트할 수 있다.

### 4.12 내장 터미널 (신규, 공통 인프라)
xterm.js와 `pty.*`를 쓴다. 쓰임새는 대화형 설치기, OAuth 로그인, TUI 전용 확장 폴백, 사용자가 원할 때 진짜 `pi` TUI 열기다.

**구현 메모 (M2, v0.23)**: 사용자 결정에 따라 터미널은 **Electron main에서 node-pty로** 띄운다. 데몬의 `pty.*`는 두지 않는다.
- node-pty 1.1.0은 N-API라 Electron용으로 다시 빌드할 필요가 없고, Windows 사전 빌드를 포함한다.
- 로컬은 찾은 Pi의 node와 cli.js로 직접(pi.cmd shim 없이), 셸은 PowerShell로 띄운다.
- WSL은 `wsl.exe -d <배포판> --cd <폴더>`로 실행한다. Windows ConPTY가 WSL까지 감싸므로 크기 조정이 리눅스까지 전달된다(데몬 쪽 `script` 방식은 크기 조정이 안 된다).
- 원격(SSH)은 M3에서 같은 방식(`ssh -t`)으로 붙인다.
- 화면은 작업 영역 아래 도크(여러 탭, 접기)다. 열기는 명령 팔레트의 "터미널: pi 열기·셸 열기"다.
- OAuth 로그인은 프로바이더 탭의 버튼으로 한다. pi를 띄우고 화면이 잠잠해진 뒤 `/login <프로바이더>`를 대신 입력한다.

## 5. 상세 설계 포인트

### 5.1 PiLocator (Host Agent 내부)
1. 탐색 순서: 사용자 지정 경로 → 관리형 설치 경로 → `npm root -g`/`@earendil-works/pi-coding-agent` → PATH의 `pi` → 구 패키지 `@mariozechner/pi-coding-agent`(감지되면 이전 안내)
2. 실행은 `node <pkg>/dist/bundle/cli.js --mode rpc`로 한다. Windows `.cmd` shim 문제를 피하기 위해서다.
3. SDK는 `import(pathToFileURL(<pkg>/dist/index.js))`로 동적 로드한다.

### 5.2 SessionHost
- 세션 하나에 RpcClient 하나. 모든 명령에 `id`를 붙여 응답을 매칭하고 타임아웃을 건다.
- 프로세스가 죽으면 마지막 `sessionFile`로 재시작하고 사용자에게 알린다.

### 5.3 pi-desktop-bridge 확장
RPC 프로세스를 띄울 때 `-e <bridge>`로 주입한다. 사용자 settings에는 기록하지 않는다.
- `/desktop:reload` → `ctx.reload()`: 리소스를 편집한 뒤 프로세스 재시작 없이 반영
- `/desktop:resources` → 현재 로드된 확장·스킬·프롬프트·툴 목록을 JSON으로 반환
- `/desktop:lease` → 세션 소유권 하트비트(§5.4)

**구현 메모 (M4, v0.32)**: `/desktop:reload`만 만들었다.
- 확장 파일: 데몬이 다른 모듈을 import하지 않는 TypeScript 한 파일을 앱 홈의 `bridge/pi-desktop-bridge-<해시>.ts`에 한 번 쓴다. 세션을 열 때 `-e`로 넣으며, 그 호스트의 Pi가 jiti로 불러온다. `PI_DESKTOP_NO_BRIDGE=1`이면 넣지 않는다.
- 명령 동작: 작업 중이면 알림만 하고 반영하지 않는다. 아니면 `ctx.reload()`를 부른다. reload 뒤에는 예전 런타임의 ctx를 쓰면 안 되므로 바로 끝낸다.
- RPC에서 `{type:"prompt", message:"/desktop:reload"}`를 보내면 확장 명령으로 처리된다(`disposition: "handled"`). LLM은 부르지 않고 대화에도 남지 않는다. 실제 Pi 계약 테스트로 확인한다.
- 앱의 안전장치: 보내기 전에 `get_commands`에 `desktop:reload`가 있는지 확인한다. 앱 업데이트 전에 연 세션에는 bridge가 없어서, 그대로 보내면 LLM에 질문으로 가기 때문이다.
- 확인하다 알게 된 것: **RPC 모드는 프로젝트 신뢰를 묻지 못한다**(security.md "Project trust without an interactive prompt").
  - 저장된 신뢰(`~/.pi/agent/trust.json`)도 `--approve`도 없으면 프로젝트 `.pi/`의 프롬프트·스킬·확장·설정을 건너뛴다. 기본값 `defaultProjectTrust: "ask"`일 때다. AGENTS.md는 신뢰와 상관없이 불러온다.
  - 그래서 앱에서 처음 연 프로젝트는 `.pi/` 리소스가 빠진다. 리소스 창은 신뢰 여부를 따지지 않고 보여 주므로, 실제와 다르게 보일 수 있다.
  - 처음에는 bridge가 `project_trust` 이벤트로 묻는 방안을 생각했다. 그러나 Pi는 확장의 답을 저장된 결정보다 먼저 쓰므로(project-trust.js), `/trust`로 저장한 결정까지 덮어쓰게 되어 택하지 않았다. 아래 v0.33 구현 메모를 본다.

**구현 메모: 프로젝트 신뢰 (M4, v0.33)**
- 데몬
  - `trust.get({cwd})`: 그 호스트 Pi의 SDK(`hasTrustRequiringProjectResources`, `ProjectTrustStore`, `SettingsManager.getDefaultProjectTrust`)로 Pi와 같은 순서로 정한다. 필요 없음 → 저장된 결정 → 기본값 순이다. 결과는 `trusted`·`untrusted`·`ask`다.
  - `trust.set({cwd, decision})`: Pi의 `trust.json`에 저장하거나 지운다. 터미널 pi의 `/trust`와 같은 파일이다.
  - `session.open`의 `trust: "yes"|"no"`는 그 실행에만 `--approve`·`--no-approve`로 넘긴다.
- 앱
  - 세션을 여는 모든 경로(새 세션·다시 열기·기록에서 열기·분기)가 열기 전에 확인한다. `ask`면 대화상자로 묻는다.
  - 선택지: 이번만 신뢰하지 않고 열기(첫 선택, 가장 안전) / 신뢰하고 열기(기억) / 이번만 신뢰하고 열기 / 신뢰하지 않음으로 기억하고 열기. Esc는 열지 않는다.
  - 상태를 읽지 못하면(예전 데몬) 묻지 않고 Pi 기본 동작에 맡긴다.
- 리소스 창
  - 신뢰 상태 안내와 "이 폴더 신뢰"·"저장된 결정 지우기" 버튼을 둔다.
  - 불러오지 않는 project 리소스에 배지를 단다. 저장하지 않은 폴더는 "이번만 신뢰"로 연 세션에는 불러와져 있을 수 있어서 "신뢰해야 불러옴"으로 표시한다.
  - 신뢰를 바꿔도 이미 열린 세션은 Pi가 시작할 때 정한 그대로다.
- 실제 Pi 계약 테스트로 확인한 것
  - 정해진 것이 없으면 프로젝트 프롬프트를 건너뛴다.
  - "이번만" 결정은 저장하지 않고 적용된다.
  - 저장한 결정은 다음 실행부터 묻지 않고 쓰인다.

### 5.4 TUI와 병행 사용 (신규)

Pi는 세션 파일 잠금을 문서화하지 않았다. 그래서 **같은 세션 파일에 두 프로세스가 동시에 쓰는 상황을 GUI가 막는다.**

| 상황 | 동작 |
|---|---|
| GUI만 사용 | 정상 |
| TUI가 세션 X를 쓰는 중에 GUI가 X를 엶 | 감지: 세션 JSONL의 최근 mtime과 append 감시, 그리고 같은 `sessionFile`을 인자로 가진 `pi` 프로세스 탐색(로컬은 프로세스 목록, 원격은 Agent의 `ps`). **팔로우 모드(읽기 전용)**로 열어 파일 tail로 실시간 표시한다. 버튼: "포크해서 GUI에서 계속" / "TUI 종료 후 이어받기" |
| GUI가 세션 X를 쓰는 중에 TUI가 X를 엶 | 막을 수 없다. GUI가 자기가 쓰지 않은 append를 감지하면 경고 배너를 띄우고 GUI 쪽 입력을 잠근다 |
| 설정·리소스 파일을 TUI/에디터에서 수정 | `fs.watch`로 즉시 반영한다. GUI에서 편집 중이었다면 3-way 병합 다이얼로그 |
| GUI에서 리소스 수정 → 실행 중인 TUI | TUI 쪽에는 `/reload` 안내만 표시한다(TUI를 원격 조작하지 않음) |

추가로 **"이 세션을 TUI에서 열기"** 버튼을 둔다. GUI 쪽 세션을 정지한 뒤 내장 터미널이나 외부 터미널에서 `pi --session <file>`로 연다.

**구현 (v0.7, M1)**
- 다른 프로그램이 쓰는 중인지 판단: 기록에서 연 세션 파일이 **최근 2분 안에 수정**됐고 이 데몬의 실행 중 세션이 쓰는 파일이 아니면(`stored.inspect`의 `ownedBy` 없음) 바로 열지 않고 "읽기 전용으로 따라가기 / 분기해서 새 세션으로 이어 쓰기 / 그래도 이 파일로 열기"를 묻는다. 프로세스 목록으로 찾는 방식은 TUI가 `pi --continue`처럼 경로 없이 실행되면 찾을 수 없어 쓰지 않았다.
- 팔로우 모드: Pi를 띄우지 않고 파일을 직접 읽어(`stored.read`, Pi SDK 순수 함수로 해석) 보여주고, `fs.watchFile`로 변경을 감시한다. `SessionManager.open`은 파일을 다시 쓸 수 있어 쓰지 않는다. TUI는 완료된 메시지만 파일에 쓰므로 스트리밍 중간 상태는 보이지 않는다.
- 분기해서 이어 쓰기: `pi --fork <파일>`로 새 파일에서 이어 간다. 원래 파일은 건드리지 않는다.
- TUI에서 열기: GUI 쪽 Pi를 닫고 터미널 명령을 복사한 뒤 같은 파일을 팔로우한다.
- GUI가 쓰는 세션 파일에 TUI가 끼어드는 경우의 감지(위 표 세 번째 줄, v0.8): 데몬이 우리 Pi의 마지막 활동(이벤트 수신, 명령 전송) 시각을 기록하고, **파일 수정 시각이 그보다 3초 이상 뒤이면서 새로 덧붙은 부분에 대화 메시지 항목이 있으면** 다른 프로그램이 쓴 것으로 본다. 감지 알림 시각이 아니라 mtime으로 비교하는 이유는 파일 감시가 주기적 stat이라 알림이 늦게 오기 때문이다(처음 구현에서 실제로 오탐). 감지되면 앱은 입력을 잠그고 "닫고 따라가기 / 복제해서 계속 / 무시하고 계속"을 제시한다.

### 5.5 WSL 특이사항
- 호스트 목록에 설치된 배포판을 자동으로 표시한다.
- 경로 변환: Windows 경로로 연 프로젝트(`C:\src\app`)를 WSL Pi로 돌리면 `/mnt/c/src/app`. 성능 경고를 보여주고 WSL 내부 경로 사용을 권장한다.
- WSL 쪽 `~/.pi/agent`와 Windows 쪽 `~/.pi/agent`는 **별개의 설정**이다. 호스트 배지로 항상 구분해서 보여준다. 호스트 간 공유는 §5.9의 복사 기능으로만 한다.
- (M1 구현에서 확인한 사항)
  - `/etc/wsl.conf`에서 automount를 끈 환경에서는 WSL 안에서 Windows 드라이브가 보이지 않는다. 그래서 Agent 번들을 WSL 홈 `~/.pi-desktop/agent/host-agent-<버전>-<해시>.mjs`로 업로드해 실행한다. 경로 변환(`/mnt/c`)도 이런 환경에서는 쓸 수 없으므로, WSL 프로젝트는 WSL 내부 경로로만 연다.
  - `wsl.exe -- <명령>`은 인자를 이어 붙여 기본 셸이 다시 해석한다. 여러 줄 스크립트와 `$` 변수가 깨지므로 항상 `wsl.exe --exec`로 호출한다.
  - 공식 설치기로 설치한 Pi는 `.bashrc`에서만 PATH에 들어가므로, 데몬은 관리형 설치 구조(`~/.pi/agent/install/current-version`)를 직접 읽어 찾는다.
  - systemd가 켜진 WSL(Ubuntu)에서는 연결기가 끊긴 뒤에도 데몬과 Pi가 계속 실행되는 것을 확인했다. 장시간(수십 분 이상) 유휴 상태에서의 생존 여부는 아직 확인하지 않았다.
- **폴더 탐색 (M3 첫 단계, v0.26)**: Windows 폴더 선택 대화상자는 WSL 안을 보여주지 못하므로, 로컬이 아닌 호스트에서는 "폴더 선택"이 앱의 폴더 탐색 창을 연다. SSH 호스트도 같은 창을 쓴다.
  - 데몬의 `fs.listDir`가 그 호스트에서 한 폴더의 하위 폴더만 돌려준다. 경로가 비었거나 `~`면 홈, 상대 경로는 홈 기준이다. 폴더를 가리키는 링크도 폴더로 치고, 한 번에 2000개까지 담는다.
  - 창은 경로 입력·홈·경로 마디(누르면 이동)·하위 폴더 목록으로 되어 있다. 글자를 치면 하위 폴더를 거르고, ↑·↓와 Enter로 들어가며, 거르기 칸이 빈 채 Backspace는 상위 폴더, Ctrl+Enter는 지금 폴더 선택이다. 숨김 폴더는 기본으로 감춘다.
  - 입력창에 이미 경로가 있으면 그 폴더에서 열고, 없는 경로면 홈에서 연다.
  - 확인하며 알게 된 것: 연결기는 소켓에 떠 있는 데몬에 버전 확인 없이 붙어서, 예전 데몬이 살아 있으면 새 메서드를 몰랐다("알 수 없는 메서드"). v0.27에서 빌드 식별자를 비교해 교체하도록 고쳤다(§3.4 구현 메모).

### 5.6 원격(SSH) 특이사항
- 인증은 OS `ssh`와 ssh-agent에 맡긴다. GUI는 비밀번호나 키를 저장하지 않는다.
- 파일 피커, diff, 편집은 모두 Agent의 `fs.*`로 처리한다. 큰 파일은 스트리밍하고 크기 제한을 둔다.
- 이미지 붙여넣기는 원격 임시 폴더로 업로드한 뒤 경로를 전달한다.
- 네트워크가 끊기거나 GUI를 닫아도 Pi 프로세스는 원격 데몬 아래에서 계속 실행된다. 다시 연결하면 저널로 이어 붙인다(§3.4).
- SSH 연결이 끊긴 것을 빨리 알아채도록 `ServerAliveInterval`을 설정하고, 지수 백오프로 자동 재연결한다.
- **구현 메모: SSH 호스트 (M3, v0.28)**
  - 호스트 등록: 호스트 선택 목록의 "SSH 호스트 관리…"에서 이름·접속 대상(`user@host` 또는 `~/.ssh/config`의 Host 이름)·포트만 받는다. 앱 userData의 `ssh-hosts.json`에 저장하고, 인증 정보는 담지 않는다. 호스트 id는 `ssh:<이름>`이다.
  - 실행: OS의 `ssh`를 쓴다. Windows는 Git 등 다른 ssh보다 `System32OpenSSHssh.exe`를 먼저 쓴다. 공통 옵션은 다음과 같다.
    - `BatchMode=yes`: 비밀번호를 묻지 않고, 키 인증이 안 되면 실패한다.
    - `StrictHostKeyChecking=accept-new`: 처음 보는 호스트 키는 받고, 바뀐 키는 거부한다.
    - `ServerAliveInterval=15`, `ConnectTimeout=10`
  - 원격 명령은 로그인 셸 종류와 상관없도록 `sh -c …`로 감싼다.
  - Agent 배포는 WSL과 같은 절차를 공통 모듈(remote-agent.ts)로 쓴다: node 확인 → 홈의 `~/.pi-desktop/agent/`에 해시 이름으로 업로드 → `exec node <agent> connect`.
  - 오류 안내: 키 인증 실패에는 키 등록 방법을, 호스트 키 변경과 접속 실패에는 확인할 것을 덧붙인다. Node가 없으면 Termux용 명령(`pkg install nodejs-lts`)도 안내한다.
  - 내장 터미널은 `ssh -t`로 붙인다. 셸은 서버의 로그인 셸이고, pi는 데몬이 찾은 node·cli.js로 실행한다. 그래서 Pi 관리 창의 설치·OAuth 로그인도 SSH 호스트에서 된다.
  - Android(Termux, Node가 `android`로 알림)에서는 공식 설치기가 돌지 않으므로 Pi 설치 안내를 npm 전역 설치로 바꾼다.
  - 확인한 환경: Termux sshd(포트 8022)가 켜진 Android 15 휴대폰(aarch64, Node 24.18 LTS)
    - Agent 자동 배포, 폴더 탐색, 터미널로 Pi 설치(npm 전역)
    - 세션 열기와 `!` 셸 명령
    - 앱을 닫았다 다시 열면 휴대폰의 데몬·Pi가 살아 있고, 세션과 출력이 그대로 이어짐
  - 아직 하지 않은 것
    - `~/.ssh/config` 호스트 자동 가져오기
    - 비밀번호·암호 걸린 키 입력 (ssh-agent에 올린 키는 됨)
    - 휴대폰에서 LLM으로 실제 대화(자격 증명 없음)
    - Android가 백그라운드의 Termux를 멈추는 경우의 대응(Termux wake lock)

### 5.7 ConfigService — 안전한 파일 편집
- 모든 쓰기는 Host Agent의 원자적 쓰기를 쓴다. JSON은 jsonc-parser로 부분 수정해서 원본 포맷과 주석을 보존한다. 저장 전 스키마 검증, `.bak` 1개 유지.
- 저장 후 열린 세션에 "리로드" 배너 → `/desktop:reload`
- `auth.json`은 쓰기만 하고, 렌더러로는 프로바이더 이름과 상태만 보낸다.

### 5.8 보안
- 렌더러: `contextIsolation`, `sandbox`, nodeIntegration 끔. IPC 채널은 화이트리스트와 zod로 검증한다.
- 외부 스크립트(설치기 등)는 항상 내용을 보여주고 동의를 받은 뒤 실행한다.
- 원격 명령 실행은 Agent 프로토콜로만 한다. 임의 셸 문자열은 사용자가 직접 입력한 경우에만 허용한다.

### 5.9 호스트 간 리소스 복사 (v0.4 확정)

**원칙**: 호스트(로컬 Windows, 각 WSL 배포판, 각 SSH 서버)마다 `~/.pi/agent`를 **독립적으로 관리**한다. 공유가 필요하면 사용자가 명시적으로 **복사**한다. 복사한 뒤에는 두 사본이 서로 영향을 주지 않는다. 자동 동기화는 하지 않는다.

**복사 대상과 방법**

| 리소스 | 복사 방법 | 주의 |
|---|---|---|
| 스킬 (폴더) | 폴더 전체를 대상 호스트의 같은 범위(user/project)로 복사 | 스킬이 실행하는 프로그램이 대상 OS에 있는지 경고 |
| 프롬프트 템플릿 (`.md`) | 파일 복사 | — |
| 확장 (파일·폴더) | 파일 복사 | OS 의존 코드(경로 구분자, `powershell` 등) 정적 감지 후 경고 |
| Pi 패키지 | 파일이 아니라 **선언을 옮긴다**: 대상 호스트에서 `pi install <같은 source>` 실행. 리소스 필터 설정도 함께 복사 | 로컬 경로 패키지는 경로가 달라지므로 폴더째 복사한 뒤 새 경로로 설치할지 묻는다 |
| AGENTS.md / SYSTEM.md / APPEND_SYSTEM.md (user 범위) | 파일 복사 | 대상에 이미 있으면 diff를 보여주고 덮어쓰기·병합·취소 선택 |
| settings.json | **항목 단위로 골라서** 복사 (전체 덮어쓰기 금지) | `shellPath`, `sessionDir`처럼 호스트마다 달라야 하는 항목은 기본으로 제외 |
| models.json | 프로바이더·모델 항목 단위로 골라서 복사 | `localhost` 엔드포인트는 대상 호스트에서 접근 가능한지 경고 |
| auth.json (인증 정보) | **복사하지 않는다** | 대상 호스트에서 다시 로그인하도록 Providers 화면으로 안내 |

**사용 흐름**
1. 리소스 목록이나 상세 화면에서 "다른 호스트로 복사"를 누른다. 여러 개를 골라 한꺼번에 복사할 수도 있다.
2. 대상 호스트를 고르고(여러 개 가능), 범위(user / 특정 프로젝트)를 고른다.
3. **미리보기**: 대상에 새로 생기는 파일, 바뀌는 파일(diff), 이름이 충돌하는 항목, 경고를 보여준다.
4. 적용하면 Host Agent의 원자적 쓰기로 저장하고, 해당 호스트에 열린 세션에 리로드 배너를 띄운다.
5. Marketplace에서 설치할 때도 설치 대화상자에서 대상 호스트를 여러 개 고를 수 있다. 같은 source로 각 호스트에 따로 설치한다.

**출처 기록**: 복사 이력(원본 호스트, 경로, 시각, 파일 해시)을 GUI 메타데이터(`userData/copies.json`)에 남긴다. 리소스 상세 화면에 "Windows에서 복사됨 · 이후 원본이 바뀜" 같은 정보를 보여주고, 다시 복사할 때 바뀐 부분만 diff로 보여준다. 이 정보는 안내용일 뿐이고 자동으로 반영하지 않는다.

**호스트 비교 화면** (선택): 두 호스트를 골라 리소스 목록을 나란히 놓고, 한쪽에만 있는 것과 내용이 다른 것을 표시한다. 여기서 바로 복사할 수 있다.

## 6. 기술 스택

| 영역 | 선택 |
|---|---|
| 셸 | Electron + electron-vite, electron-builder (Windows 우선, macOS/Linux) |
| UI | React 19 + TypeScript + Tailwind + shadcn/ui, Zustand, TanStack Query |
| 에디터 / 터미널 | Monaco / xterm.js + node-pty |
| 채팅 렌더링 | react-markdown + shiki, diff는 `diff` + 자체 뷰어 |
| 폼 | JSON Schema 기반 자동 폼 |
| Host Agent | Node 22+, 의존성 없는 esbuild 단일 번들, JSON-RPC 2.0 over stdio |
| SSH | 시스템 `ssh`(ControlMaster), 필요 시 `ssh2` |
| 테스트 | Vitest, Playwright-Electron(E2E), **Pi 계약 테스트**(실제 `pi --mode rpc` 대상, Pi 최신 버전으로 매일 실행), WSL·SSH는 Docker sshd 컨테이너로 통합 테스트 |

## 7. 폴더 구조 (안)

```
pi-desktop/
├ apps/desktop/
│  ├ src/main/      HostManager, transports/{local,wsl,ssh}, WorkspaceManager, CatalogService, LeaseManager, ipc/
│  ├ src/preload/   contextBridge API (typed)
│  └ src/renderer/  features/{chat,sessions,context,prompts,skills,extensions,marketplace,providers,settings,pi-manager,playground,inspector,terminal}
├ packages/
│  ├ host-agent/    대상 호스트에서 도는 Agent: agentd(상주 데몬, 세션·저널) + connect(연결기)
│  ├ host-protocol/ Agent ↔ App 메시지 타입 (zod)
│  ├ pi-protocol/   Pi RPC·이벤트 타입 (관대한 파싱)
│  ├ bridge/        pi-desktop-bridge 확장
│  ├ catalog/       CatalogProvider: npm, pi.dev, github, url
│  └ harness/       Playground용 observe(session)
├ templates/        스킬·프롬프트·확장·SDK 스캐폴드
└ docs/DESIGN.md
```

## 8. 로드맵 (채팅 우선으로 재조정)

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **M0 스파이크** | 로컬 `host-agentd` + `connect` + `pi.rpc.open` + 스트리밍 채팅 1회 + 툴 이벤트 표시 | Electron 창에서 로컬 `pi`와 대화 가능. **처음부터 데몬 구조로 만든다** (나중에 바꾸면 비용이 큼) |
| **M1 Chat 완성 + WSL** | **WSL 호스트(관리형 Pi 탐색, Agent 자동 배포, 호스트 선택) — 사용자 요청으로 M3에서 앞당김**, §4.1 전체, 세션 목록·재개·트리·fork, 확장 UI 다이얼로그, 워크스페이스 탭(여러 프로젝트), Activity 사이드바, **세션 lease와 TUI 팔로우 모드**, **이벤트 저널·재연결·GUI 재시작 후 세션 복원(로컬)** | 일상 작업에서 TUI 없이 지낼 수 있다 |
| **M2 Pi Manager + Providers** | 로컬 설치·업데이트·제거·롤백, API 키 폼, OAuth용 내장 터미널, models.json | 새 PC에서 GUI만으로 Pi 설치부터 첫 대화까지 가능 |
| **M3 SSH (+ WSL 보강)** | SSH transport, Agent 부트스트랩·배포, WSL 내부 폴더 탐색, 원격 데몬 분리 실행, 원격 파일 피커, 자동 재연결, 다중 GUI writer 권한 | 원격 작업 중 GUI를 닫았다 다시 열어도 그대로 이어서 작업할 수 있다 |
| **M4 리소스 관리 + Marketplace** | AGENTS.md 계층, 프롬프트·스킬·확장 CRUD, bridge reload, 설정 폼, npm·GitHub 카탈로그 검색·설치·제거·업데이트, 호스트 간 복사(§5.9) | 클릭으로 커뮤니티 리소스를 찾아 설치하고 즉시 쓸 수 있다 |
| **M5 개발자 도구 + 다듬기** | SDK Playground, Event Inspector, Extension Dev Mode, 호스트 비교 화면, 인스톨러·자동 업데이트 | 배포 |

> M3(원격)를 M4보다 앞에 둔 이유: Host Agent 구조가 원격에서 실제로 버티는지 일찍 검증해야, 그 위에 올라가는 리소스 관리·Marketplace를 다시 만들 일이 없다.

## 9. 리스크

| 리스크 | 대응 |
|---|---|
| Pi RPC·이벤트 스키마 변경 | 관대한 파싱 + raw 폴백, 매일 계약 테스트, 설치 버전의 d.ts로 타입 생성 |
| 패키지 스코프·이름 변경 (이미 한 번 있었음) | PiLocator 후보 목록 + 사용자 지정 경로 |
| 세션 파일 동시 쓰기 | §5.4의 lease·팔로우 모드. Pi가 공식 잠금을 추가하면 그쪽으로 전환 |
| 원격 호스트에 Node 없음 또는 버전 낮음 | 부트스트랩 단계에서 감지하고 설치 마법사로 연결 |
| node-pty 네이티브 빌드 (원격) | pty 기능을 선택 사항으로 두고 `script`/python 대체 경로 사용 |
| 데몬과 GUI의 버전 불일치 | 프로토콜 버전 협상, 세션이 없을 때만 데몬 교체 (§3.4) |
| WSL 배포판 자동 종료로 데몬이 죽음 | systemd 켜진 Ubuntu에서 연결 끊김 후 생존 확인(M1). 장시간 유휴와 systemd 없는 배포판은 미확인 → 필요하면 keep-alive |
| 저널 메모리 사용량 | 세션당 링버퍼 상한(기본 1만 이벤트). 넘치면 오래된 것부터 버리고 스냅샷으로 복구 |
| 커뮤니티 확장의 악성 코드 | 설치 전 경고, 소스·의존성 요약, 프로젝트 trust 연동. 코드 실행 자체를 막지는 못한다는 점을 명시 |
| Windows 셸 (Git Bash 필요) | Pi Manager 전제 조건 점검에서 안내 |

## 10. 정리된 질문들 (v0.4)

| 질문 | 결론 |
|---|---|
| pi.dev 갤러리 공개 API | 없음. npm `pi-package` 키워드 검색을 사용한다 (§4.6) |
| GUI를 닫아도 원격 작업 유지 | 유지한다. 상주 데몬과 이벤트 저널로 재연결한다 (§3.4) |
| 호스트 간 리소스 공유 | **확정: 호스트마다 따로 관리하고, 필요할 때 복사해서 적용한다.** 자동 동기화는 넣지 않는다 (§5.9) |

## 11. 개발 방식

### 11.1 언어 규칙
- 소스 주석, 커밋 메시지(제목·본문), PR 설명, 문서는 **모두 한글**로 쓴다.
- 코드 식별자(변수·함수·타입 이름)와 로그 키는 영어로 쓴다. 사용자에게 보이는 UI 문자열은 i18n 리소스로 분리하고, 기본 언어는 한국어로 한다.

### 11.2 커밋 단위 — 코드 리뷰가 가능한 크기
- **한 커밋 = 한 가지 관심사.** 리팩터링, 기능 추가, 포맷 변경을 섞지 않는다.
- 커밋마다 빌드와 테스트가 통과해야 한다. 중간 커밋을 체크아웃해도 동작해야 한다.
- 크기는 diff 기준 대략 400줄 이하를 목표로 한다. 자동 생성 파일과 lockfile은 별도 커밋으로 분리한다.
- 새 모듈은 "타입·인터페이스 → 구현 → 테스트 → 연결(wiring)" 순서로 나눠 커밋하면 리뷰하기 쉽다.

### 11.3 커밋 메시지 형식
[Conventional Commits](https://www.conventionalcommits.org/) 타입 접두어 + 한글 설명:

```
feat(host-agent): 세션 이벤트 저널과 seq 기반 재연결 추가

- 세션마다 RPC 이벤트에 순번을 붙여 링버퍼와 디스크에 기록
- attach(sessionId, lastSeq) 호출 시 누락 이벤트를 재생
- 저널에서 잘린 경우 get_messages 스냅샷으로 복구

관련: docs/DESIGN.md §3.4
```

| 타입 | 용도 |
|---|---|
| `feat` | 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변화 없는 구조 변경 |
| `test` | 테스트만 추가·수정 |
| `docs` | 문서 |
| `build` / `ci` | 빌드 설정, CI |
| `chore` | 그 밖의 잡무 (의존성 갱신 등) |

범위(scope)는 §7의 폴더 이름을 쓴다: `host-agent`, `pi-protocol`, `bridge`, `catalog`, `desktop-main`, `desktop-renderer` 등.

### 11.4 브랜치와 PR
- `main`은 항상 동작하는 상태를 유지한다. 작업은 `feat/<마일스톤>-<주제>` 브랜치에서 하고 PR로 합친다.
- PR 하나는 마일스톤 안의 기능 하나 단위로 만든다. 설명에는 변경 요약, 관련 설계 문서 절, 테스트 방법, 스크린샷(UI 변경 시)을 넣는다.
- 병합은 커밋 이력이 그대로 남도록 rebase merge나 merge commit을 쓴다. squash하면 리뷰 단위로 나눈 커밋이 사라지므로 쓰지 않는다.

### 11.5 main 브랜치 룰셋 ("main 보호")
GitHub 저장소 룰셋으로 위 규칙을 강제한다.

| 규칙 | 설정 |
|---|---|
| 브랜치 삭제 | 금지 |
| 강제 push | 금지 |
| 병합 | PR 필수, 허용 방식은 merge commit·rebase (squash 불가), 리뷰 스레드는 모두 해결해야 함 |
| 필수 승인 수 | 0 (1인 저장소라 본인 PR을 스스로 승인할 수 없기 때문. 협업자가 생기면 1로 올린다) |
| 필수 상태 검사 | CI 4개 작업: `ubuntu-latest / Node 22·24`, `windows-latest / Node 22·24` |
| 우회 | 저장소 관리자. 문서 변경을 main에 바로 push하는 용도로만 쓴다 |

CI 작업 이름(`.github/workflows/ci.yml`의 매트릭스)을 바꾸면 룰셋의 필수 상태 검사 이름도 함께 바꿔야 한다. 그렇지 않으면 PR이 영원히 대기 상태가 된다.
