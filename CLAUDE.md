# pi-desktop 작업 규칙 (Claude 세션용)

이 저장소에서 일하는 모든 Claude 세션이 따른다. PC의 Claude 데스크톱 앱, 휴대폰 Claude 앱의 클라우드 세션, worktree 세션 모두 같다.
언어·커밋 단위·커밋 메시지·브랜치·main 룰셋·릴리스 태그는 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)를 따른다. 세 앱의 역할과 데이터 경계는 [docs/DESIGN-APPS.md](docs/DESIGN-APPS.md)를 따른다.

## 1. 어디서 누가 일하나

- 개발은 **이 저장소(`skax-soulfactor/pi-desktop`) 한 곳에서만** 한다.
  - PC에서는 `skax-soulfactor` 계정으로 일한다.
  - 클라우드에서는 `soulfactorx` 계정으로 일한다. 이 계정은 이 저장소에 쓰기 권한이 있다.
  - 두 계정 모두 이 저장소에 직접 브랜치를 만들고 PR을 연다.
- 포크 `soulfactorx/pi-desktop-mobile`에서는 개발하지도 릴리스하지도 않는다. 휴대폰 웹 버전(pi-web)은 이 저장소로 옮겼다(`packages/web-shell`, 각 앱의 `src/server`·`src/web`, 루트 `scripts/build-web.mjs`·`scripts/web`).
- 클라우드 세션은 리눅스에서 돈다. 타입 검사·테스트·웹 빌드는 되지만, Windows 전용 동작과 Electron 창은 확인할 수 없다. 이런 것은 CI의 windows 칸에 맡기고, PR 본문에 "PC에서 확인 필요"라고 남긴다.

### 휴대폰 웹 버전(pi-web)

- 세 앱의 화면 코드를 휴대폰 브라우저에서도 쓴다. 화면 코드를 고치면 웹도 함께 바뀐다. CI가 웹도 빌드한다.
- **웹은 별도 제품이 아니라 같은 앱의 다른 빌드 대상이다.** `-web` 패키지를 따로 만들지 않는다.
  - 웹 진입점은 각 앱 안에 둔다: `src/server`(웹 서버), `src/web`(화면 시작점·web.css), `vite.web.config.ts`, `scripts/build-web.mjs`. 앱마다 `npm run build:web -w <앱>` → `out/web`.
  - 세 앱 묶음은 루트에서 만든다: `npm run build:web`(→ `out/pi-web`), `npm run dist:web`(→ `release/web`의 `pi-web.tar.gz`, `install-termux.sh`).
  - 서버의 주소·토큰 확인, 화면 파일, 공유 받기, 서비스 워커, 푸시는 `packages/web-shell`에서 함께 쓴다. 앱 서버에 다시 만들지 않는다.
  - 웹에서만 쓰는 의존성(ws, web-push 등)은 앱의 `dependencies`에 넣지 않는다. electron-builder가 `dependencies`를 설치 파일에 담기 때문이다. 웹 서버는 esbuild로 한 파일에 묶으므로 `devDependencies`로 충분하다. `out/web`도 electron-builder.yml에서 뺀다.
- **휴대폰 전용 동작은 `isWebClient()`(각 앱 `renderer/clipboard-images.ts`) 뒤에 둔다.** CSS는 선택자를 `:root[data-client="web"]`로 묶는다.
  - `pointer: coarse`, `hover: none` 같은 터치 판정만으로 켜지 않는다. 터치 노트북·S펜 기기의 Electron 앱도 이 판정에 걸린다.
  - 화면 폭(`max-width`)으로 줄바꿈만 바꾸는 것은 데스크톱에도 해가 없으므로 그대로 써도 된다.
- 웹 묶음(`pi-web.tar.gz`)과 Termux 설치 스크립트(`install-termux.sh`)는 Pi Desktop 릴리스(`v*`)에 함께 올라간다. 그래서 웹 쪽만 바뀌어도 Pi Desktop을 릴리스한다.

## 2. 작업이 끝나면: push·PR·머지·릴리스까지

이 저장소는 개인 저장소다. 작업이 끝나면 묻지 않고 끝까지 처리한다.

1. 작업 브랜치에 커밋하고 push한 뒤 PR을 연다. 초안 PR이 아니다.
2. CI 4칸(ubuntu·windows × Node 22·24)이 끝날 때까지 기다린다.
   - 실패하면 원인을 보고 고친다.
   - 코드와 관계없이 가끔 실패하는 테스트(§4)가 원인이면 실패한 작업만 다시 돌린다. 그래도 같은 테스트가 또 실패하면 원인을 찾는다.
3. **머지 전에 다른 세션의 일을 확인한다.** `gh pr list --state open`과 `git branch -r --no-merged origin/main`으로 남은 PR·브랜치를 본다.
   - CI가 통과했고 충돌이 없는 PR은 함께 머지한다.
   - 확인이 필요한 PR(CI 실패, 충돌, "PC에서 확인 필요")은 머지하지 말고 목록으로 알린다.
4. merge commit으로 머지한다. 그 뒤 main CI가 통과하는지 확인한다.
5. 릴리스한다(§3). 머지만 하고 릴리스하지 않은 채 두지 않는다. 다른 세션이 머지하고 릴리스하지 않은 변경도 함께 나간다.
6. 빌드가 끝날 때까지 기다린 뒤, 머지한 PR·릴리스 주소·빌드 결과를 보고한다.

멈추고 묻는 경우: 강제 push, 히스토리 재작성, 브랜치·태그·릴리스 삭제, 저장소 설정 변경, 메이저·마이너 버전 올리기.

## 3. 릴리스: 세 앱을 같은 버전, 한 릴리스로

2026-11-02부터 **세 앱(Pi Desktop·Agent·Mate)과 웹 묶음은 같은 버전 번호를 쓴다** (0.6.0부터).
세 앱이 공용 패키지를 함께 써서 거의 늘 같이 바뀌고, "어느 앱을 릴리스할지" 고르다 빠뜨리는 일(예: agent-kit을 고치고 Agent만 릴리스)이 생겼기 때문이다.

- 0.6.4부터 **태그 하나(`vX.Y.Z`)로 세 앱과 웹 묶음을 한 릴리스에 함께 올린다** (`.github/workflows/release.yml` 하나).
  - 한 앱만 바뀌었어도 세 앱을 함께 낸다. 바뀌지 않은 앱도 같은 번호로 다시 빌드된다.
  - 자동 업데이트 정보 파일은 앱마다 이름이 달라 한 릴리스에서 겹치지 않는다: Pi Desktop `latest*.yml`, Agent `agent*.yml`, Mate `mate*.yml` (각 앱 `electron-builder.yml`의 `publish.channel`). 이 이름을 바꾸면 설치본이 업데이트를 못 찾는다.
  - `agent-v*`·`mate-v*` 태그는 더 붙이지 않는다. 0.6.4의 `agent-v0.6.4`·`mate-v0.6.4` 릴리스는 0.6.3 이하 설치본이 올라오는 징검다리이므로 **지우지 않는다** (옛 설치본은 가장 높은 `agent-v*`·`mate-v*` 릴리스의 `latest.yml`을 본다).
- 다음 번호: 가장 높은 `v*` 태그의 **패치를 올린다** (예: 0.6.0 → 0.6.1). 마이너·메이저를 올릴 때는 사용자에게 묻는다.
- 문서만 바뀌었으면 릴리스하지 않는다. 문서 밖의 파일(코드, 빌드 설정, 워크플로, `package.json`)이 바뀌었으면 릴리스한다.
  ```bash
  git diff --name-only v<마지막 번호>..origin/main -- . ':!*.md' ':!docs'
  ```
- 태그는 main CI가 통과한 머지 커밋에 붙인다. 붙이기 직전에 `origin/main`이 그 커밋인지 다시 본다.
- 다음 번호는 앞 릴리스 빌드가 모두 끝난 뒤에 붙인다.

## 4. 가끔 실패하는 테스트

| 테스트 | 증상 | 지금까지 한 것 |
|---|---|---|
| agent-kit `peer-tasks.test.ts` "받는 쪽 스케줄러" | windows에서 받은 작업이 `running`에서 끝나지 않음, 또는 `EPERM: operation not permitted, rename …tasks…json` | **원인 찾음:** Windows는 다른 곳이 읽는 파일로 이름을 바꾸지 못한다. 작업 기록 저장(`tasks/store.ts`)이 잠깐 기다렸다 다시 하게 고쳤다(포크에서 옮김). 그 전에 #115 동기화 겹침, #163 워커 안의 피어 서버도 고쳤다. 또 실패하면 실패 메시지의 "워커 기록"을 본다 |
| mate-runner `real-pi.test.ts` "git 계기" | Windows에서 시간 초과 | #116 pid 파일 재사용 문제 고침 |

새로 이런 테스트를 만나면 이 표에 더한다.
