# Pi Desktop Mate

묻기 전에 먼저 살펴보고 알려 주는 **능동형 코딩 동료**. 정한 때에 Pi가 작업 폴더를 읽기만 하며 살펴보고, 결과와 제안을 인박스에 남긴다.
설계는 [docs/DESIGN-MATE.md](../../docs/DESIGN-MATE.md).

Pi Desktop(`apps/desktop`)·Pi Desktop Agent(`apps/agent`)와는 별도 앱이다. 데이터 홈도 따로 쓴다(`~/.pi-desktop-mate`).
Pi 설정·로그인(`~/.pi/agent`)은 같이 쓰므로 API 키를 다시 넣을 필요가 없다.

## 구성

| 패키지 | 하는 일 |
|---|---|
| `apps/mate` | Electron 앱: 인박스·임무·실행 기록·설정 |
| `packages/mate-runner` | 상주 실행기: 시간표를 지키고 실행마다 `pi --mode json`을 띄운다. 앱을 닫아도 돈다 |
| `packages/mate-kit` | Pi 확장: 권한 단계 강제(`mate-guard`), 제안 도구(`mate_propose`) |

## 쓰는 법

1. **임무** 탭에서 새 임무를 만든다 (템플릿: 아침 브리핑·CI 확인·의존성 점검).
   - 하는 일: **보고**(실행마다 결과 한 건) 또는 **제안**(알릴 것이 있을 때만).
   - 언제: 직접 실행만 / 일정 간격(최소 15분) / 정한 시각(요일 선택).
2. **지금 실행**으로 바로 돌려 보거나, 시간표를 기다린다.
3. 앱을 켜면 **인박스**에 쌓인 결과·제안을 보고 확인함·버리기를 누른다.

어느 쪽이든 파일을 바꾸거나 쓰기 명령을 실행하지 않는다. 쓰기 도구는 Pi에 선언하지 않고, bash는 읽기 명령(git·gh 조회, ls·cat·grep 등)만 통과한다.
기본 모델은 `anthropic/claude-haiku-5-5`이고 설정에서 바꾼다.

알아 둘 것:

- 실행기는 앱을 처음 열 때 뜬다. PC를 다시 켠 뒤에는 앱을 한 번 열어야 다시 돈다 (로그인 시 시작은 M3).
- 꺼져 있던 동안 놓친 시간표는 한 번만 따라잡는다. 하루 시간표 실행 상한(기본 20회)과 실행당 시간 제한(기본 300초)이 있다.
- 실행 세션은 `~/.pi-desktop-mate/sessions`에 남아 Pi Desktop·TUI 세션 목록에 섞이지 않는다.

## 개발

```bash
npm run dev:mock -w @pi-desktop/mate
```

API 키 없이 mock LLM(포트 18913)으로 띄운다. Mate 홈은 `.dev/mate-home`, Pi 설정은 `.dev/mate-pi-agent`라 실제 데이터와 Pi Desktop·Agent 개발 실행을 건드리지 않는다.
임무 지시에 다음을 넣으면 mock이 그대로 행동한다.

- `안녕` → `echo: 안녕` (보고 결과 확인)
- `tool:mate_propose {"title":"…","summary":"…","severity":"warn"}` → 제안
- `bash:rm -f hello.txt` → 막히는지 확인

```bash
npm test -w @pi-desktop/mate-runner
```

이 명령은 실행기를 빌드한 뒤, 실제 Pi와 mock LLM으로 계약 테스트를 돌린다. 확인하는 것은 제안·중복 제거, 쓰기·`rm` 차단, 상주 실행기의 지금 실행이다.
