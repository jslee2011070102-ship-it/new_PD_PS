# 썸네일 분석 도구

쿠팡 등 이커머스 제품 썸네일에서 가격·용량·시장지표를 뽑아 엑셀로 정리하는 도구.
프로젝트 맥락과 다음 작업 계획은 `CLAUDE.md` 참고.

## 설치

```bash
python -m venv venv
source venv/bin/activate   # Windows는 venv\Scripts\activate
pip install -r requirements.txt
```

API 키나 별도 CLI 설치는 필요 없다. 이미지를 읽는 일은 Claude가 하고,
이 도구는 그 결과를 검증·계산해서 엑셀로 만드는 역할만 한다.

## 사용법

### 1) prepare — 캡처 폴더 정리

```bash
python analyze_thumbnails.py prepare --folder ./캡처 --out ./준비됨
```

HEIC를 JPG로 바꾸고, 회전 정보를 반영하고, 최대 1024px로 줄이고,
`01.jpg, 02.jpg ...` 로 번호를 매긴다. `mapping.json`에 원본 파일명 대응표가 남는다.

### 2) 추출 — 이미지를 보고 JSON 작성

준비된 이미지를 Claude에게 주고 `ProductInfo` 스키마대로 추출하게 한다.
결과는 아래 형태의 JSON 배열이다.

```json
[
  {"file": "01.jpg", "brand": "피지", "price_krw": 14160,
   "capacity_text": "26개입", "composition_text": "1개",
   "unit_price_text": "1개입당 545원", "product_form": "파우치",
   "product_role": "본품", "form_reason": "지퍼형 파우치 포장",
   "category_rank_text": "캡슐세제 구매 1위", "review_count": 14723,
   "monthly_buyers_text": "한 달간 3만명 이상 구매했어요",
   "product_name": "...", "notes": null}
]
```

### 3) build — 검증·계산·엑셀

```bash
python analyze_thumbnails.py build --input 추출.json \
  --channel 쿠팡 --category 캡슐세제 --output 결과/캡슐세제.xlsx
```

- 추출 결과를 `ProductInfo` 스키마로 검증한다. 칸이 빠지거나 정해진 값이
  아니면 **그 자리에서 멈추고** 어느 항목이 왜 틀렸는지 알려준다.
- 같은 엑셀 파일이 이미 있으면 아래에 이어붙인다 (누적 데이터베이스처럼 사용).
- 저장 후 `단가검증` 요약을 출력한다. 확인이 필요한 행만 알려준다.

## 결과 엑셀 보는 법

- **`단가기준`** — 그 행의 단가가 무엇 기준인지 알려준다. 액체류는 `100ml당`/`100g당`,
  캡슐세제처럼 개수로 파는 제품은 `1개당`이다.
  **기준이 다른 행끼리 `단위당가격`을 직접 비교하면 안 된다.**
- **`단가검증`** — 쿠팡이 화면에 표시하는 단가와 우리 계산을 대조한 결과.
  - `일치` — 용량·가격을 제대로 읽었다는 뜻
  - `불일치(표기 A / 계산 B)` — 둘 중 하나를 잘못 읽었을 가능성. 원본 확인 필요
  - `표기없음` — 화면에 단가 표기가 없었음 (검증 불가, 오류 아님)
- **`제품형태`**(용기/파우치/말통/기타)와 **`제품역할`**(본품/리필/불명)은 별개다.
  말통 형태의 리필 제품이 실제로 존재하므로 두 칸을 함께 봐야 한다.
- **`추정월매출(원)`은 어림값이다.** `월구매자수 x 판매가 x 2`로 계산한다.
  2를 곱하는 이유는 한 상품 페이지에 다른 옵션들이 묶여 있기 때문이다.
  구매자수가 "300명 **이상**"처럼 하한으로만 표시되므로 실제보다 낮게 나오기 쉽다.
  절대 금액으로 쓰지 말고 **제품 간 규모 비교용**으로 볼 것.
- **`월구매자수(명)`이 비어 있는데 `구매자수_원문`에는 글자가 있다면**, 그 문구가
  "만족했어요"였다는 뜻이다. 만족한 사람 수는 구매자수가 아니므로 매출 계산에서
  제외된다. 오류가 아니다.

## 브라우저로 수집하기 (캡처 없이)

캡처 화면에는 주소가 없어 상품 URL을 알 수 없다. 브라우저 확장(Claude in Chrome 등)에
대신 찾아달라고 할 수 있고, 그때 쓸 지시문을 명령으로 만들어 준다.
**제품명을 손으로 옮기다 빠뜨리는 일을 막기 위한 것이다.**

```bash
# 상품 URL 수집 지시문 (여러 카테고리에서 골라 뽑기)
python analyze_thumbnails.py urls --excel 결과/분석.xlsx \
  --select 캡슐세제:7,11,12,13 세탁세제:1,2,3

# 한 카테고리 전체
python analyze_thumbnails.py urls --excel 결과/분석.xlsx --category 캡슐세제
```

출력된 글을 그대로 브라우저 확장에 붙여넣으면 된다. **파일 첨부는 필요 없다** —
확장은 브라우저 화면을 보는 것이라 파일을 읽지 않는다.

받아온 JSON의 `product_url`을 추출 JSON의 `product_url` 칸에 넣고 다시 `build` 하면,
다음 회차부터는 검색 없이 바로 열 수 있다.

## 상세페이지 USP 분석 (`analyze_details.py`)

썸네일이 "얼마에 파는가"라면, 이쪽은 **"왜 그 값을 받는가"**를 뽑는다.

```bash
# 1) 캡처 파일 확인 (쪽수/크기 점검 + 번호 매기기)
python analyze_details.py inventory --folder ./상세캡처 --out ./상세준비됨

# 2) Claude가 DetailPageInfo 스키마대로 추출 → JSON

# 3) 검증·집계·엑셀 (썸네일 결과를 주면 순위·단가가 함께 붙는다)
python analyze_details.py build --input usp추출.json \
  --category 캡슐세제 --output 결과/캡슐세제_USP.xlsx \
  --thumbnails 결과/쿠팡_생활용품_전체.xlsx
```

출력 엑셀은 시트 3개다.

- **유형별집계** — 이 카테고리에서 무엇이 표준 소구점인지. 등장수/제품수/상단배치/강조
- **제품별요약** — 제품당 USP 개수, 상단 배치 수, 주요 유형, 경쟁사 비교 유무, 인증 수
  (`--thumbnails`를 주면 순위·단가·리뷰수가 붙어 **"비싼 제품은 뭘 내세우나"**를 볼 수 있다)
- **USP전체** — 소구점 한 줄 = 한 행. `근거문구`는 페이지에 적힌 원문 그대로다

### 상세페이지 캡처 방법 (PC 크롬 권장)

```
1. 상세페이지를 열고 → 맨 아래까지 한 번 쭉 스크롤   ← 반드시
2. Ctrl + P  →  "PDF로 저장"
```

**맨 아래까지 먼저 내리는 게 핵심이다.** 쿠팡 상세페이지 이미지는 화면에 보일 때
비로소 불러오므로(lazy loading), 안 내리고 저장하면 빈 칸투성이 PDF가 된다.
`inventory`가 쪽수를 세서 1~2쪽짜리를 "스크롤 전에 저장한 것 같다"고 알려준다.

갤럭시에서 찍는다면, 캡처 후 뜨는 툴바의 **아래 화살표(⌄)**를 계속 누르면
스크롤하며 한 장으로 이어붙여진다.

## 폴더 구조

```
thumbnail_analyzer/
├── analyze_thumbnails.py   # 2단계: 썸네일 → 가격·시장지표 (prepare / build)
│                           #   ProductInfo 클래스가 추출 항목의 설계도.
├── analyze_details.py      # 4단계: 상세페이지 → USP (inventory / build)
│                           #   DetailPageInfo, UspItem이 설계도.
├── requirements.txt
├── CLAUDE.md               # 프로젝트 전체 맥락 (Claude Code용)
└── README.md               # 이 파일
```
