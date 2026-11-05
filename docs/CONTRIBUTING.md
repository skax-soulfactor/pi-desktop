# 개발 방식

이 저장소의 앱(Pi Desktop과 그 안의 Pi·Agent·Mate 작업 공간)과 공용 패키지에 함께 적용하는 규칙이다.
처음에는 [DESIGN.md](DESIGN.md) §11에 있었고, 앱이 늘면서 여기로 옮겼다.

## 1. 언어 규칙

- 소스 주석, 커밋 메시지(제목·본문), PR 설명, 문서는 **모두 한글**로 쓴다.
- 코드 식별자(변수·함수·타입 이름)와 로그 키는 영어로 쓴다. 사용자에게 보이는 UI 문자열의 기본 언어는 한국어로 한다.

## 2. 커밋 단위 — 코드 리뷰가 가능한 크기

- **한 커밋 = 한 가지 관심사.** 리팩터링, 기능 추가, 포맷 변경을 섞지 않는다.
- 커밋마다 빌드와 테스트가 통과해야 한다. 중간 커밋을 체크아웃해도 동작해야 한다.
- 크기는 diff 기준 대략 400줄 이하를 목표로 한다. 자동 생성 파일과 lockfile은 별도 커밋으로 분리한다.
- 새 모듈은 "타입·인터페이스 → 구현 → 테스트 → 연결(wiring)" 순서로 나눠 커밋하면 리뷰하기 쉽다.

## 3. 커밋 메시지 형식

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
| `perf` | 성능 개선 |
| `test` | 테스트만 추가·수정 |
| `docs` | 문서 |
| `style` | 화면 스타일·포맷 |
| `build` / `ci` | 빌드 설정, CI |
| `chore` | 그 밖의 잡무 (의존성 갱신 등) |

범위(scope)는 고친 앱·패키지 이름을 쓴다. 앱 안에서 한쪽만 고쳤으면 `-main`·`-renderer`를 붙여도 된다.

| 영역 | scope |
|---|---|
| `apps/desktop` | `desktop` |
| `apps/agent` | `agent`, `agent-main`, `agent-renderer` |
| `apps/mate` | `mate`, `mate-main`, `mate-renderer` |
| `packages/host-agent`, `packages/host-protocol` | `host-agent`, `host-protocol` |
| `packages/agent-kit` | `agent-kit` |
| `packages/mate-kit`, `packages/mate-runner` | `mate-kit`, `mate-runner` |
| `packages/pi-isolation` | `pi-isolation` |

## 4. 브랜치와 PR

- `main`은 항상 동작하는 상태를 유지한다. 작업은 `feat/<주제>`·`fix/<주제>`·`docs/<주제>` 브랜치에서 하고 PR로 합친다. 앱이 드러나게 `feat/mate-…`, `feat/agent-…`처럼 앞에 앱 이름을 붙인다.
- PR 하나는 기능 하나 단위로 만든다. 설명에는 변경 요약, 관련 설계 문서 절, 테스트 방법, 스크린샷(UI 변경 시)을 넣는다.
- 한 앱의 작업은 다른 앱의 폴더를 고치지 않는다. 공용 패키지(`host-agent`·`host-protocol`)를 고치면 그것을 쓰는 앱(Pi Desktop·Agent)을 함께 확인한다.
- 병합은 커밋 이력이 그대로 남도록 merge commit을 쓴다. squash하면 리뷰 단위로 나눈 커밋이 사라지므로 쓰지 않는다.

## 5. main 브랜치 룰셋 ("main 보호")

GitHub 저장소 룰셋으로 위 규칙을 강제한다.

| 규칙 | 설정 |
|---|---|
| 브랜치 삭제 | 금지 |
| 강제 push | 금지 |
| 병합 | PR 필수, 허용 방식은 merge commit·rebase (squash 불가), 리뷰 스레드는 모두 해결해야 함 |
| 필수 승인 수 | 0 (1인 저장소라 본인 PR을 스스로 승인할 수 없기 때문. 협업자가 생기면 1로 올린다) |
| 필수 상태 검사 | CI 4개 작업: `ubuntu-latest / Node 22·24`, `windows-latest / Node 22·24` |
| 우회 | 없음. 문서 변경도 PR로 합친다. 평소 작업 계정이 관리자라 우회를 열면 세션도 규칙을 건너뛸 수 있기 때문이다. CI 장애 등 긴급할 때만 잠시 "For pull requests only"로 열고 바로 닫는다 |

CI 작업 이름(`.github/workflows/ci.yml`의 매트릭스)을 바꾸면 룰셋의 필수 상태 검사 이름도 함께 바꿔야 한다. 그렇지 않으면 PR이 영원히 대기 상태가 된다.

## 6. 릴리스

태그 하나(`vX.Y.Z`), 워크플로 하나(`.github/workflows/release.yml`), 릴리스 하나로 올린다. 그 릴리스가 Latest다. **0.7.0부터 설치본은 Pi Desktop 하나다** (Agent·Mate는 그 안의 작업 공간).

| 올라가는 것 | 파일 이름 | 자동 업데이트 정보 파일 |
|---|---|---|
| Pi Desktop (Agent·Mate 포함) | `Pi-Desktop-*` | `latest.yml`·`latest-mac.yml`·`latest-linux.yml` (Latest 릴리스를 봄) |
| 휴대폰 웹 묶음 | `pi-web.tar.gz`, `install-termux.sh` | 없음 (`pi-web update`가 Latest를 받음) |
| 옛 단독 Agent·Mate 징검다리 (**v0.7.0에만**) | `Pi-Desktop-Agent-*`, `Pi-Desktop-Mate-*` | `agent*.yml`, `mate*.yml` |

- 옛 단독 Agent·Mate 설치본은 가장 높은 `v*` 릴리스의 자기 채널 파일을 본다. v0.7.0 뒤 릴리스에는 그 파일이 없어 0.7.0 징검다리에 머문다. **v0.7.0 릴리스는 지우지 않는다.** 워크플로는 v0.7.0에서만 Agent·Mate를 만든다 (만들기만 할 때 `bridge`를 켜면 미리 만들어 볼 수 있다).
- 0.6.3까지는 앱마다 태그(`v*`·`agent-v*`·`mate-v*`)와 릴리스가 따로 있었다. `agent-v0.6.4`·`mate-v0.6.4`는 옛 설치본이 0.6.4로 올라오는 징검다리 릴리스이므로 지우지 않는다.
- 태그를 push할 수 없는 곳(클라우드 세션 등)에서는 Actions의 "Release"를 `version`(예: `v0.7.1`)을 넣어 돌린다. 고른 브랜치의 커밋에 태그를 만들고 올린다. `version`을 비우면 만들기만 한다.
- **Pi Desktop과 웹 묶음은 같은 버전 번호로 함께 릴리스한다** (0.6.0부터 세 앱이 같은 번호였다). Host Agent 데몬(`packages/host-agent`)도 릴리스 때 같은 번호로 빌드한다 (워크플로가 `package.json` 버전을 맞춘다. 저장소의 `0.0.1`은 개발 빌드에서만 보인다). 자세한 규칙은 저장소 [CLAUDE.md](../CLAUDE.md) §3.
- 문서만 바뀌었으면 릴리스하지 않는다.
- 설치 파일과 웹 묶음에는 `LICENSE`와 `THIRD_PARTY_NOTICES.txt`가 함께 들어간다. 고지는 빌드할 때 `scripts/third-party-notices.mjs`가 만든다. 묶이지 않는 빌드 도구를 새로 쓰면 그 스크립트의 `BUILD_ONLY`에 더한다.
- 릴리스를 겹쳐 돌리지 않는다. 앞 빌드가 끝난 뒤 다음 번호를 붙인다.
- 태그는 주석 태그로 붙인다: `git tag -a v0.6.4 -m "Pi Desktop v0.6.4"`.
