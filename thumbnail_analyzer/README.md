# 썸네일 분석 도구

쿠팡 등 이커머스 제품 썸네일 이미지를 분석해서 브랜드/용량/가격/제품형태를
엑셀로 정리하는 도구. 프로젝트 맥락과 다음 작업 계획은 `CLAUDE.md` 참고.

## 설치

### 1) Anthropic 공식 CLI (`ant`)

API 호출은 `ant`가 담당한다. **API 키를 따로 발급받을 필요가 없고**,
브라우저 로그인 한 번이면 된다.

```bash
brew install anthropics/tap/ant          # macOS
# 그 외 OS: https://github.com/anthropics/anthropic-cli

ant auth login                           # 브라우저가 열림
ant auth status                          # 로그인 확인
```

> 이미 `ANTHROPIC_API_KEY` 환경변수가 설정돼 있으면 로그인 정보보다 **그쪽이 우선**한다.
> 로그인 계정으로 쓰려면 해당 환경변수를 지울 것.

### 2) 파이썬 패키지

```bash
python -m venv venv
source venv/bin/activate   # Windows는 venv\Scripts\activate
pip install -r requirements.txt
```

## 실행

Batch API를 쓰기 때문에 **제출 → 확인 → 회수** 3단계로 나뉜다.
보통 1시간 이내에 끝나며, 요금은 일반 요청의 **50%** 다.

```bash
# 1) 제출 — 보내고 바로 끝난다. 터미널을 닫아도 된다.
python analyze_thumbnails.py submit \
  --folder ./images/쿠팡_캡슐세제 \
  --channel 쿠팡 --category 캡슐세제

# 2) 확인 — 다 됐는지 본다
python analyze_thumbnails.py status

# 3) 회수 — 끝난 작업의 결과를 엑셀로 받는다
python analyze_thumbnails.py fetch --output 결과/캡슐세제_분석.xlsx
```

- `--folder`: 이미지가 들어있는 폴더 (jpg / jpeg / png / webp / **heic** / heif)
- `--channel` / `--category`: 태깅용 (분석에 영향 없음, 나중에 필터링용)
- `--model`: 기본값 `claude-sonnet-5`. 비용을 더 아끼려면 `claude-haiku-4-5-20251001`
- `--output`: 저장할 엑셀 경로. 같은 파일이 이미 있으면 아래에 이어붙임
- `--jobs-dir`: 제출 기록 보관 폴더 (기본 `.batch_jobs`)

여러 카테고리를 연달아 `submit` 해두고, 나중에 `fetch` 한 번으로
전부 같은 엑셀에 모을 수 있다. 회수한 작업은 다시 회수되지 않는다.

### 결과 엑셀 보는 법

- **`단가검증`** 칸을 먼저 볼 것. 쿠팡이 화면에 표시하는 `(100ml당 N원)`과
  우리 계산을 대조한 결과다.
  - `일치` — 용량·가격을 제대로 읽었다는 뜻
  - `불일치(표기 A / 계산 B)` — 둘 중 하나를 잘못 읽었을 가능성. 원본 이미지 확인 필요
  - `표기없음` — 화면에 단가 표기가 없었음(검증 불가, 오류는 아님)
- **`제품형태`**(용기/파우치/말통/기타)와 **`제품역할`**(본품/리필/불명)은 별개다.
  말통 형태의 리필 제품이 실제로 존재하므로 두 칸을 함께 봐야 한다.

### 알아둘 점

- **아이폰 캡처(.HEIC)를 그대로 넣어도 된다.** 변환할 필요 없다.
  `pillow-heif`가 설치돼 있어야 하며, `requirements.txt`에 포함돼 있다.
  혹시 빠져 있으면 제출 전에 멈추고 설치 방법을 알려준다 (조용히 건너뛰지 않는다).
- 폰 사진의 회전 정보(EXIF)를 반영해서 보낸다. 옆으로 누운 채 전달돼 글자를
  못 읽는 일이 없다.
- 이미지가 아닌 파일이 폴더에 섞여 있으면 제외하고 그 사실을 알려준다.
  (`.DS_Store` 같은 숨김 파일은 알림에서 제외)

- 배치는 **24시간 안에 끝나지 않으면 만료**된다. 만료된 요청은 요금이 청구되지 않으며,
  해당 행의 비고란에 만료 표시가 남는다. 다시 `submit` 하면 된다.
- 개별 요청이 실패해도 배치 전체가 실패하지는 않는다. 실패 사유는 비고란에 기록된다.
- `.batch_jobs/` 의 기록 파일이 있어야 결과를 회수할 수 있다. 지우지 말 것.

## 폴더 구조

```
thumbnail_analyzer/
├── analyze_thumbnails.py   # 2단계: 썸네일 → 구조화 데이터 추출
│                           #   ProductInfo 클래스가 추출 항목의 설계도.
│                           #   항목을 바꾸려면 이 클래스만 수정하면 됩니다.
├── requirements.txt
├── CLAUDE.md               # 프로젝트 전체 맥락 (Claude Code용)
└── README.md               # 이 파일
```
