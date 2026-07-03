# Wide Worker

**단독 머신 자율 브라우저 에이전트** — 한 대의 PC 안에서 [webclaw](https://github.com/DureClaw/webclaw)(브라우저 손)와 두뇌가 함께 돌아, 마스터 세션 없이도 자율로 동작한다.

```
같은 PC 안 (localhost)
┌─────────────────────────────────────────────┐
│  Chrome + webclaw 확장                        │
│      │ 마커 없는 지시 위임                      │
│      ▼                                        │
│  Wide Worker :4111  /brain/exec               │
│      ├─▶ ① Claude Code CLI (구독)             │
│      └─▶ ② api.baryon.ai (BARYON_API_KEY)     │
└─────────────────────────────────────────────┘
```

- **1차 목표**: 단독 머신 완결 — 외부 버스·마스터 불필요. webclaw가 받은 지시를 로컬 두뇌가 처리.
- 의존성 0 (Node 18+ 표준 라이브러리만).

## 설치

```powershell
irm https://raw.githubusercontent.com/DureClaw/wide-worker/main/install.ps1 | iex
```

## 실행

```powershell
cd $env:USERPROFILE\dev\WideWorker
.\start.cmd
```
콘솔에 `listening on http://0.0.0.0:4111` 이 뜨면 준비 완료.

## 두뇌 백엔드 (둘 중 하나)

Wide Worker는 `claude-cli → baryon-api` 순으로 시도한다.

### ① api.baryon.ai — 권장 (자동화에 확실)
`config.local.json`에 키만 넣으면 된다:
```json
{ "BARYON_API_KEY": "sk-...", "BARYON_MODEL": "claude-sonnet-5" }
```

### ② Claude Code CLI (구독)
`claude`가 로그인돼 있으면 자동 사용. **단, Claude Max/Pro 구독의 대화형 로그인만으로는 headless(`claude -p`)가 401**이 날 수 있다 — 자동화/headless 호출은 API 인증 경로를 요구하기 때문. 이 경우 ①(baryon 키)을 쓰거나, 그 PC에서 `ANTHROPIC_API_KEY`를 설정한다.

## webclaw 연동 (같은 PC)

webclaw 확장 팝업:
- **Brain URL**: `http://localhost:4111`
- **Brain token**: `config.local.json`의 `BRAIN_TOKEN`과 동일 (비우면 인증 없음)

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | 백엔드 가용성 — `{ok, backends:{"claude-cli":"버전"\|false,"baryon-api":url\|false}}` |
| `POST /brain/exec` `{prompt}` | 실행 — `{output, backend}` |

## 설정 (`config.local.json` / 환경변수)

| 키 | 기본 | 설명 |
|---|---|---|
| `PORT` | 4111 | 수신 포트 |
| `BRAIN_TOKEN` | (없음) | Bearer 인증 |
| `CLAUDE_BIN` | claude | Claude Code CLI 경로 |
| `BARYON_API_URL` | https://api.baryon.ai | Anthropic 호환 엔드포인트 |
| `BARYON_API_KEY` | (없음) | 설정 시 활성화 |
| `BARYON_MODEL` | claude-sonnet-5 | 모델 |

## 로드맵

- **1차 (현재)**: 단독 머신 자율 — localhost webclaw ↔ 로컬 brain.
- 2차(예정): DureClaw 플릿 연동 — 원격 마스터가 노드로 오케스트레이션.

DureClaw 패밀리: [dureclaw](https://github.com/DureClaw/dureclaw) · [webclaw](https://github.com/DureClaw/webclaw) · wide-worker

## License

MIT
