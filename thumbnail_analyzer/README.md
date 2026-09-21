# 썸네일 분석 도구

쿠팡 등 이커머스 제품 썸네일 이미지를 분석해서 브랜드/용량/가격/제품형태를
엑셀로 정리하는 도구. 프로젝트 맥락과 다음 작업 계획은 `CLAUDE.md` 참고.

## 설치

```bash
python -m venv venv
source venv/bin/activate   # Windows는 venv\Scripts\activate
pip install -r requirements.txt
```

> `anthropic` 1.7.0 이상이 필요합니다 (Structured Outputs 사용).
> 예전 버전(0.x)이 깔려 있다면 `pip install -U -r requirements.txt`로 올려주세요.

`ANTHROPIC_API_KEY` 환경변수 설정 필요 (Claude Console에서 발급):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## 실행

```bash
python analyze_thumbnails.py \
  --folder ./images/쿠팡_캡슐세제 \
  --channel 쿠팡 \
  --category 캡슐세제 \
  --output 결과/캡슐세제_분석.xlsx
```

- `--folder`: 이미지가 들어있는 폴더
- `--channel` / `--category`: 태깅용 (분석에 영향 없음, 나중에 필터링용)
- `--output`: 저장할 엑셀 경로. 같은 파일이 이미 있으면 아래에 이어붙임
- `--model`: 기본값 `claude-sonnet-5`. 비용을 아끼려면 `claude-haiku-4-5-20251001`

## 폴더 구조

```
thumbnail_analyzer/
├── analyze_thumbnails.py   # 2단계: 썸네일 → 구조화 데이터 추출
│                           #   ProductInfo 클래스가 추출 항목의 설계도.
│                           #   항목을 바꾸려면 이 클래스만 수정하면 됩니다.
├── requirements.txt
├── CLAUDE.md                # 프로젝트 전체 맥락 (Claude Code용)
└── README.md                 # 이 파일
```
