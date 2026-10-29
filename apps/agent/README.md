# Pi Desktop Agent

Pi를 엔진으로 쓰는 데스크톱 에이전트입니다. Pi Desktop과는 **별도의 앱**이며, 기능은 Pi 패키지인
[`packages/agent-kit`](../../packages/agent-kit)(확장·스킬)으로 구현합니다.

- 설계: [docs/DESIGN-AGENT.md](../../docs/DESIGN-AGENT.md)
- 현재 단계: **P2** — 로컬 모델 대응(local-model)과 제자리 돌기 차단(loop-guard). qwen3.5:9b 실측은 설계 §7 절차로

## 구조

```
apps/agent/            이 앱 (main · preload · React 렌더러)
packages/agent-kit     에이전트 기능 묶음 (Pi 패키지: 확장·스킬, 터미널 pi에도 설치 가능)
packages/host-agent    Pi Desktop과 같은 Host Agent (데몬 홈만 따로 씀)
```

- Host Agent 데몬은 `~/.pi-desktop-agent`를 씁니다. Pi Desktop의 `~/.pi-desktop`과 나눠 두 앱이 서로의 데몬을 바꾸지 않게 합니다.
- Pi 설정과 세션(`~/.pi/agent`)은 Pi Desktop·터미널 pi와 함께 씁니다.
- 세션을 열 때 agent-kit 확장을 `-e`로 올립니다. 사용자 `settings.json`에는 기록하지 않습니다.

## 실행

API 키 없이 mock LLM으로 실행합니다 (포트 18912, Pi Desktop의 dev:mock과 동시에 띄울 수 있음).

```bash
npm run dev:mock -w @pi-desktop/agent
```

- 프롬프트 예: `안녕` → echo, `read:package.json` → read 툴 호출(묻지 않음), `bash:echo hi` → 승인 화면, `/agent:status` → agent-kit 버전 알림
- 데몬 홈은 저장소의 `.dev/agent-home`, Pi 설정은 `.dev/pi-agent`로 격리됩니다.

설치된 Pi로 실행할 때는 `npm run dev -w @pi-desktop/agent`를 씁니다.

## 설치 파일과 릴리스

```bash
npm run dist -w @pi-desktop/agent
```

지금 OS용 설치 파일을 `apps/agent/release/`에 만듭니다 (올리지 않음). 설치본은 Host Agent 번들과 agent-kit 소스를 리소스로 싣고,
**대상 PC에 설치된 Pi**(`npm install -g @earendil-works/pi-coding-agent`)를 씁니다.

릴리스는 `agent-v`로 시작하는 태그를 올리면 `.github/workflows/release-agent.yml`이 세 OS에서 만들어
이 저장소의 GitHub Releases에 올립니다. **Latest로 표시하지 않아** Pi Desktop(`v*`)의 자동 업데이트와 섞이지 않습니다 (Pi Desktop Mate의 `mate-v*`와 같은 방식, 설계 §0).
자동 업데이트는 아직 없습니다.

```bash
git tag -a agent-v0.1.0 -m "Pi Desktop Agent v0.1.0"
```

```bash
git push origin agent-v0.1.0
```

Actions 탭에서 "Release Agent"를 손으로 돌리면 만들기만 하고 올리지 않습니다. 코드 서명은 하지 않습니다 (Pi Desktop README "코드 서명"과 같음).

## 테스트

```bash
npm test -w @pi-desktop/agent-kit
```

실제 Pi(저장소의 devDependency)에 agent-kit을 `-e`로 올려 확인하는 계약 테스트를 포함합니다.
