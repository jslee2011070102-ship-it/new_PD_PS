# 상세페이지 USP 원본 (브라우저에서 받은 JSON)

브라우저(Claude in Chrome)에서 받은 결과를 **그대로** 이 폴더에 저장한다.
파일명은 `<카테고리>_<묶음번호>.json` (예: `세탁세제_01.json`).

## 왜 원본을 저장소에 남기는가

엑셀(`*.xlsx`)은 `.gitignore`로 제외되고, 작업 환경은 일회용이라 사라진다.
150개를 여러 날에 걸쳐 나눠 수집하므로, **진행 상황이 사라지면 처음부터 다시** 해야 한다.
원본 JSON을 남겨두면:

- 엑셀을 언제든 다시 만들 수 있다 (`build --input data/usp`)
- 어디까지 수집했는지 알 수 있다 (`targets --all --done data/usp`)
- 집계 방식을 바꿔도 재수집이 필요 없다

추출 원본을 남기는 이유는 `data/extracted/`와 같다 — 필름은 보관하고 인화지는 버린다.

## 사용법

```bash
cd thumbnail_analyzer

# 다음에 볼 제품 목록 + 붙여넣을 지시문 (남은 것만)
python3 analyze_details.py targets --all --batch 10 --done ../data/usp

# 붙여넣을 지시문만
python3 analyze_details.py targets --all --batch 10 --done ../data/usp --prompt-only

# 받은 JSON을 이 폴더에 저장한 뒤, 전체를 엑셀로
python3 analyze_details.py build --input ../data/usp \
    --output 결과/USP.xlsx --thumbnails 결과/썸네일.xlsx
```

카테고리는 항목 ID(`세탁세제-09`)에서 자동으로 읽으므로 `--category`를 줄 필요가 없다.
