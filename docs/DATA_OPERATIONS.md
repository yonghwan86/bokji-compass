# 데이터 운영 안내 (2026-10-22)

공식 원천(정부24·복지로 OpenAPI, 보건복지부 지방정부 서비스 메뉴판)을 매일 확인하고 사이트 데이터에 반영하는 흐름, 문제가 생겼을 때의 대응과 되돌리기.

## 흐름

| 단계 | 무엇이 | 언제 | 결과 |
|---|---|---|---|
| 1. 매일 확인 | `.github/workflows/data-refresh.yml` | 매일 0시 10분(한국 시간) · 수동 실행 | `data` 브랜치 커밋, `_report.json`·`_history.json` → 사이트 `/data` |
| 2. 점검 | `pipeline/src/refresh/diff.ts` `gateCheck` | 1단계 끝 | 경고면 실패 표시 + '데이터 매일 확인 경고' 이슈 |
| 3. 사이트 데이터 다시 만들기 | `.github/workflows/data-rebuild.yml` | 1단계가 점검을 통과하면 이어서 · 수동 실행 | `auto/data-rebuild` 브랜치와 PR (머지는 사람) |
| 4. 서식 재대조 | 서식 담당 (`docs/FORM_ORIGINAL_MATCHING.md`) | 3단계 PR에서 사업 ID가 바뀌었을 때 | `public/forms/v1` 갱신 → forms-catalog 테스트 통과 |
| 5. 머지 | 소유자 | 3단계 PR이 초안이 아닐 때 | main 머지 = Vercel 운영 배포 |

- 키: `DATA_GO_KR_SERVICE_KEY`는 GitHub Secret으로만 쓴다. 출력·로그·커밋에 넣지 않는다.
- 복지로 개발계정 하루 한도(중앙 100 · 지자체 1,000)는 Actions가 혼자 쓴다. 다른 곳(맥 예약 작업 등)에서 같은 키로 받지 않는다.
- 메뉴판 표는 바뀐 PDF만 다시 읽는다. 표 읽는 방식을 고쳤으면 `parse_menus.py`의 `PARSER_VERSION`을 올린다 — 다음 매일 확인이 `parse-report.json`의 판과 비교해 모든 PDF를 한 번 다시 읽는다 (2026-10-25부터). 판을 올리기 전에 전체 다시 읽기 결과를 이전 파서와 글별로 비교해 의도한 글만 바뀌는지 확인한다.
- 자동 재생성은 번들과 함께 출처 안내 집계(`src/lib/data/dataProvenance.json`, `scripts/build-data-provenance.ts`)도 다시 만든다. 통합돌봄 출처 문구는 `meta.json`의 `icareOrigin`(메뉴판 PDF 직접 = mohw)으로 고른다. 실패한 테스트는 PR 본문에 이유 첫 줄까지 적는다.
- 자동 재생성 PR의 '빠지는 사업'은 어디로 갔는지 나눠 적는다(운영 정보로 옮김 · 합쳐짐·지역 옮김 · 이름만 바뀜 · 새 결과에 없음). 살펴볼 것은 '새 결과에 없음'뿐이다.

## 점검 경고와 대응

| 경고 | 흔한 원인 | 대응 |
|---|---|---|
| 수집 실패 (HTTP·키 오류) | 키 만료·원천 장애 | 실행 기록 확인 → 키 재발급 시 Secret 교체(소유자) |
| 이틀 연속 호출 한도 보류 | 같은 키를 다른 곳에서 씀 | 다른 수집 중지, 다음 날 확인 |
| 건수 10% 넘게 감소 | 원천이 일부만 응답 | 다음 날 다시 확인. 계속되면 `data` 브랜치 되돌리기 |
| 하루 30% 넘게 변경 | 매번 바뀌는 칸(조회수 등)이 지문에 섞임 | 그 칸을 잡음 목록(`GOV24_NOISE`·`LIST_NOISE`)에 추가 |
| 원천 건수 불일치 | 쪽 넘김 중 실패·남은 예전 쪽 파일 | 다음 날 다시 확인 |
| 칸 사라짐 | 원천 형식 변경 | 파서·정규화 코드 점검 |
| 메뉴판 결과 흔들림 | 바뀌지 않은 PDF의 표가 달라짐 | 파서·라이브러리 버전 확인 (`pipeline/mohw/requirements.txt`) |

- 경고가 나면 '데이터 매일 확인 경고' 이슈가 열리고(이미 열려 있으면 댓글), 점검을 통과하는 날 자동으로 닫힌다. 저장소를 지켜보는 사람에게 GitHub 알림이 간다 — GitHub Settings → Notifications에서 이메일 수신을 켜 둔다.
- 금액이 바뀐 사업은 경고가 아니라 `/data`의 '금액이 바뀐 사업'에 모인다. 사이트 반영 PR을 머지하기 전에 원문과 맞춰 본다.

## 멈춤 감지

- `/data`는 마지막 확인이 36시간을 넘으면 '확인 지연'을 띄운다 (`src/lib/data/freshness.ts`).
- 공개 저장소의 예약 실행(cron)은 저장소 활동이 60일 없으면 GitHub가 끈다. `data` 브랜치 매일 커밋이 활동으로 잡힐 가능성이 크지만 보장되지 않으므로, '확인 지연'이 뜨면 Actions 탭에서 '데이터 매일 확인'이 꺼졌는지 보고 Enable workflow를 누른다. GitHub는 끄기 전에 저장소 주인에게 메일을 보낸다.

## 되돌리기

### 원천(`data` 브랜치)
매일 확인은 다음 날 그 위에서 비교하므로, 잘못된 수집분은 되돌려 둔다.

```bash
git fetch origin data && git switch -c fix/data-revert origin/data
git revert --no-edit <잘못된 수집 커밋>
git push origin HEAD:data
```

여러 날을 통째로 되돌릴 때는 그 날짜들의 커밋을 차례로 revert 한다 (`git log origin/data`의 'data: YYYY-MM-DD 수집'). 강제 푸시는 쓰지 않는다 — 수집 이력이 사라진다.

### 사이트(운영 배포)
- 급할 때: Vercel → Deployments에서 직전 정상 배포 → Promote to Production (코드는 그대로, 화면만 되돌림).
- 정식: 문제의 머지 커밋을 되돌리는 PR (`git revert -m 1 <머지 커밋>`) → 머지.
- 사이트 데이터 PR(`auto/data-rebuild`)은 다음 재생성 때 덮어쓰이므로, 머지 전이면 닫기만 해도 된다.

## 저장소 설정 (소유자)
- Secrets: `DATA_GO_KR_SERVICE_KEY`
- Actions → General → Workflow permissions: 'Allow GitHub Actions to create and approve pull requests' (사이트 데이터 PR 자동 생성에 필요. 꺼져 있으면 브랜치만 올라가고 실행 요약에 PR 만들기 링크가 남는다)
- 이슈 사용 켜짐 (경고 알림)
