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

## 폴더 구조

```
thumbnail_analyzer/
├── analyze_thumbnails.py   # prepare / build 두 명령
│                           #   ProductInfo 클래스가 추출 항목의 설계도.
│                           #   항목을 바꾸려면 이 클래스만 수정하면 된다.
├── requirements.txt
├── CLAUDE.md               # 프로젝트 전체 맥락 (Claude Code용)
└── README.md               # 이 파일
```
