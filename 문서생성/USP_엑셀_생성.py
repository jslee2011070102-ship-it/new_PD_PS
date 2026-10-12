# -*- coding: utf-8 -*-
"""USP 전수조사 결과(JSON) → 엑셀.

판독하지 않은 항목의 칸은 **비워 둔다**. 같은 브랜드라고 값을 복사해 넣지 않는다.
비어 있는 칸과 '없음'은 다르다 — 전자는 모른다는 뜻이고 후자는 확인했는데 없다는 뜻이다.
이 둘을 섞으면 나중에 무엇을 더 봐야 하는지 알 수 없게 된다.
"""
import json, sys
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

HDR = ["항목", "브랜드", "제조사", "제품명", "판독",
       "효소 종수", "효소 표기", "제3자 인증", "자가 마크",
       "시험/실증", "성적서 이미지 게재", "특허", "주요 주장", "비고"]

def build(src, out):
    d = json.loads(Path(src).read_text(encoding="utf-8"))
    wb = openpyxl.Workbook()
    ws = wb.active; ws.title = d["_메타"]["카테고리"]

    thin = Side(style="thin", color="BFBFBF")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)

    # 머리말에 조사 조건을 박아 둔다. 표만 떼어 돌려도 전제가 따라가게.
    meta = d["_메타"]
    ws.append([f'{meta["카테고리"]} USP 전수조사'])
    ws["A1"].font = Font(size=14, bold=True)
    for k in ("조사일", "출처", "수집", "판독", "주의"):
        ws.append([f"{k}: {meta[k]}"])
        ws.cell(ws.max_row, 1).font = Font(size=9, color="666666")
    ws.append([])

    hr = ws.max_row + 1
    ws.append(HDR)
    for c in range(1, len(HDR) + 1):
        cell = ws.cell(hr, c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F3864")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = box

    j = lambda v: " / ".join(v) if isinstance(v, list) and v else ("없음" if isinstance(v, list) else "")
    for x in d["제품"]:
        read = bool(x.get("판독"))
        ws.append([
            x["id"], x.get("브랜드", ""), x.get("제조", ""), x.get("제품명", ""),
            "판독함" if read else "미판독",
            (x.get("효소종수") if x.get("효소종수") is not None else ("표기없음" if read else "")),
            x.get("효소표기", "") if read else "",
            j(x.get("인증")) if read else "",
            j(x.get("자가마크")) if read else "",
            j(x.get("시험")) if read else "",
            ("게재" if x.get("성적서이미지") else "없음") if read else "",
            j(x.get("특허")) if read else "",
            j(x.get("주요주장")) if read else "",
            x.get("비고", ""),
        ])
        r = ws.max_row
        for c in range(1, len(HDR) + 1):
            cell = ws.cell(r, c)
            cell.border = box
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        if not read:
            for c in range(1, len(HDR) + 1):
                ws.cell(r, c).fill = PatternFill("solid", fgColor="F2F2F2")

    for col, w in zip("ABCDEFGHIJKLMN", [13, 16, 13, 34, 8, 9, 22, 34, 26, 38, 11, 26, 52, 40]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = ws.cell(hr + 1, 1)
    wb.save(out)
    n = sum(1 for x in d["제품"] if x.get("판독"))
    print(f"{out}  —  {len(d['제품'])}행 (판독 {n} / 미판독 {len(d['제품'])-n})")

if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "USP_전수조사.xlsx")
