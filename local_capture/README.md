# 로컬 캡처 도구 — 쿠팡 상세페이지 자동 수집

사람이 손으로 하던 **검색 → 더보기 클릭 → 끝까지 스크롤 → PDF 저장**을 대신한다.

## 왜 로컬에서 돌리는가

쿠팡은 데이터센터 IP를 막는다. 서버에서 접속하면 403이 뜬다(확인함).
반면 사람이 쓰는 PC의 브라우저는 막히지 않는다. 그래서 **캡처만 사용자 PC에서** 돌리고,
나머지(검증·집계·문서화)는 그대로 둔다.

```
[사용자 PC]                          [저장소 / Claude]
검색 → 더보기 → 스크롤 → PDF 저장  →  PDF 분석 → 엑셀 → 문서
        capture_coupang.py                analyze_details.py
```

## 설치 (한 번만)

```bash
pip install playwright
python -m playwright install chromium
```

이미 Chrome이 깔려 있으면 그걸 써도 된다. 브라우저 버전이 안 맞아
`Executable doesn't exist` 오류가 나면 경로를 직접 알려준다.

```bash
# Windows (명령 프롬프트)
set COUPANG_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

# Mac / Linux
export COUPANG_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## 순서

### 0) 저장 기계부터 점검 — 쿠팡 없이

```bash
python capture_coupang.py selftest
```

가짜 긴 페이지를 만들어 스크롤·PDF·이미지 저장이 되는지만 본다.
**이게 통과하면 저장 쪽은 정상**이므로, 이후 실패는 쿠팡 접근이나 화면 구조 문제로
범위가 좁혀진다. 문제가 생겼을 때 어디를 볼지 가리는 것이 목적이다.

### 1) 로그인 (선택)

```bash
python capture_coupang.py login
```

브라우저가 열린다. 필요하면 로그인하고 터미널에서 Enter를 누른다.
로그인 상태는 `.browser_profile/` 에 남아 다음부터 자동으로 쓰인다.

### 2) 한 건만 시험 — 가장 중요한 단계

```bash
python capture_coupang.py probe --query "허니맘 캡슐세제 라벤더향" --keep-open
```

한 상품으로 전 과정을 돌려보고, **페이지에서 실제로 보이는 버튼 글자**를 뽑아
보여준다. '더보기' 버튼을 못 찾았다면 여기 출력된 글자를 보고
`capture_coupang.py` 위쪽 `EXPAND_TEXTS` 목록에 추가하면 된다.

셀렉터를 추측으로 고치지 않기 위한 장치다. 쿠팡이 화면을 바꾸면 반드시 깨지는데,
그때 무엇으로 바뀌었는지 눈으로 보고 고칠 수 있어야 한다.

### 3) 실제 수집

```bash
# 캡슐세제만, 이번엔 5건만
python capture_coupang.py run --category 캡슐세제 --limit 5

# 이어서 (이미 받은 건 건너뛴다)
python capture_coupang.py run --category 캡슐세제

# 전체
python capture_coupang.py run
```

### 4) 진행 확인

```bash
python capture_coupang.py status
```

### 5) 확보한 상품 URL을 추출 결과에 채우기

```bash
python capture_coupang.py export-urls --dry-run   # 먼저 확인
python capture_coupang.py export-urls
```

**이게 덤으로 얻는 큰 수확이다.** 현재 `data/extracted`의 `product_url`은 150건 전부
비어 있는데(앱 캡처에는 주소가 안 찍힘), 한 번 채워두면 다음 회차부터 검색 단계가
통째로 사라진다.

## 만들어지는 것

```
captures/
├── 캡슐세제-01.pdf        상세페이지 전체 (긴 페이지는 여러 쪽으로 나뉨)
├── 캡슐세제-02.pdf
├── ...
└── manifest.json          진행 기록 + 실제 상품 URL + 일치도 + 실패 사유
```

`manifest.json`에는 항목마다 아래가 남는다.

| 칸 | 뜻 |
|---|---|
| `status` | `ok` / `fail` / `low_match` |
| `url` | 실제로 연 상품 주소 |
| `matched_title` | 검색 결과에서 고른 상품의 제목 |
| `match_score` | 목표 제품명과 얼마나 겹치는지 (0~1) |
| `log` | 무엇을 했고 어디서 막혔는지 |

## 안전장치

| 장치 | 왜 |
|---|---|
| **상품당 20~40초 무작위 대기** | 사람이 보는 속도. `--gap-min/--gap-max`로 조절하되 **올리지 말 것** |
| **연속 3회 실패 시 중단** | 막힌 채로 계속 두드리면 상황이 나빠진다. `--stop-after-fails` |
| **차단 감지** | "접근이 차단", "보안 문자" 등이 보이면 저장하지 않고 기록에 남긴다 |
| **일치도 0.45 미만은 저장 안 함** | 엉뚱한 상품을 받고도 모르는 것이 가장 나쁜 실패다. `--min-score` |
| **화면이 보이는 상태로 실행** | 무엇을 하고 있는지 눈으로 보여야 막혔을 때 원인을 찾는다 |
| **매 건마다 기록 저장** | 중간에 꺼져도 앞의 결과가 남는다 |

## 캡처한 PDF를 분석으로 넘기기

```bash
cd ../thumbnail_analyzer

# 캡처 파일 점검 + 번호 매기기 (쪽수가 1~2쪽이면 스크롤 전에 저장된 것)
python analyze_details.py inventory --folder ../local_capture/captures --out ./상세준비됨

# 분석 결과 JSON을 받아 검증·집계
python analyze_details.py build --input ../data/usp --output 결과/USP.xlsx \
    --thumbnails 결과/썸네일.xlsx
```

## 알아둘 것

- **쿠팡 이용약관은 자동 수집을 제한한다.** 이 도구는 사용자 본인의 PC·브라우저로
  사람이 보는 속도로 동작하도록 만들어져 있고, 공개된 상품 정보를 경쟁 조사 목적으로
  받아온다. 사용 여부와 범위에 대한 판단은 사용자가 한다. 속도를 올리면 그 전제가 깨진다.
- **쿠팡 화면에서 실제로 동작하는지는 아직 검증되지 않았다.** 개발 환경에서 쿠팡에
  접속할 수 없어(403) 저장 기계(`selftest`)까지만 확인했다. `probe`로 한 건 돌려보고,
  막히거나 버튼을 못 찾으면 그 출력을 그대로 공유하면 고칠 수 있다.
- 셀렉터는 CSS 클래스가 아니라 **버튼에 적힌 글자**로 찾는다. 클래스명은 배포할 때마다
  바뀌지만 글자는 덜 바뀌기 때문이다. 그래도 바뀌면 `EXPAND_TEXTS`에 추가하면 된다.
