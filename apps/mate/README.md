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
   - 하는 일: **보고**(실행마다 결과 한 건), **제안**(알릴 것이 있을 때만), **고치기**(별도 작업 공간에서 고치고 승인을 기다림, git 저장소만).
   - 언제: 직접 실행만 / 일정 간격(최소 15분) / 정한 시각(요일 선택) / 저장소 변화(새 커밋) / 파일 변화(저장이 잠잠해지면) / 명령 결과 변화(예: `gh run list`).
   - 변화 계기는 처음 본 상태를 기준으로 삼고, 한 번 돈 뒤 쉬는 시간(기본 15분) 안의 변화는 모았다가 한 번 돈다.
2. **지금 실행**으로 바로 돌려 보거나, 시간표를 기다린다.
3. 앱을 켜면 **인박스**에 쌓인 결과·제안을 보고 확인함·버리기를 누른다.
   고치기 결과는 diff를 보고 **적용**(내 작업 폴더에 커밋하지 않은 변경으로 들어옴, 커밋은 직접) 또는 **버리기**를 누른다.

보고·제안은 파일을 바꾸지 않는다(쓰기 도구를 Pi에 선언하지 않음). 고치기는 사용자 저장소 HEAD에서 만든 별도 git worktree(`~/.pi-desktop-mate/worktrees`, 브랜치 없음) 안만 고칠 수 있고, 적용 전까지 내 작업 폴더는 그대로다.
bash는 어느 단계든 읽기 명령(git·gh 조회, ls·cat·grep 등)만 통과한다.
기본 모델은 `anthropic/claude-haiku-5-5`이고 설정에서 바꾼다.

알아 둘 것:

- 실행기는 앱을 열 때 뜨고, 앱을 닫아도 남는다. 설정의 **로그인할 때 실행기 시작**(설치본만)을 켜면 PC를 다시 켠 뒤 앱을 열지 않아도 돈다 (창은 뜨지 않음).
- 꺼져 있던 동안 놓친 시간표는 한 번만 따라잡는다. 하루 자동 실행 상한(기본 20회), 실행당 시간 제한(기본 300초), 실행당 비용 상한(기본 $0.5)이 있다.
- 실행 세션은 `~/.pi-desktop-mate/sessions`에 남아 Pi Desktop·TUI 세션 목록에 섞이지 않는다. 실행 기록의 **세션 보기**로 무엇을 읽고 어떤 명령이 막혔는지 볼 수 있다.

## 설치와 릴리스

- 설치 파일: GitHub Releases의 `mate-v*` 릴리스 (Windows `Pi-Desktop-Mate-Setup-*.exe`, macOS dmg, Linux AppImage/deb). 코드 서명이 없어 처음 실행할 때 경고가 나올 수 있다.
- Pi Desktop과 별도 앱이다. Mate 릴리스는 GitHub에서 Latest로 표시하지 않아 Pi Desktop 자동 업데이트에 섞이지 않는다. Mate 자동 업데이트는 아직 없다.
- 로컬에서 만들기: `npm run dist -w @pi-desktop/mate` (지금 OS용, 결과는 `apps/mate/release/`)

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
