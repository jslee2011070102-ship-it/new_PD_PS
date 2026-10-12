import json, re, openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

SRC = '/home/user/new_PD_PS/data/순위/유아치약.json'
d = json.load(open(SRC, encoding='utf-8'))
P = sorted(d['제품'], key=lambda x: x['순위'])

HDR = ['조사일자','채널','카테고리','원본파일명','브랜드명','제품명','쿠팡URL','판매가(원)','용량_원문',
       '구성_원문','총용량','단위','단위당가격(원)','단가기준','쿠팡표기단가','단가검증','제품형태',
       '제품역할','순위','순위_원문','리뷰수','월구매자수(명)','구매자수_원문','추정월매출(원)',
       '형태_판단근거','비고','중복(같은딜번호)']

def role(x):
    n = x['제품명']
    if '리필' in n: return '본품+리필'
    if '본품' in n: return '본품'
    return '불명'

rows = []
for x in P:
    calc = round(x['판매가'] / x['총용량'] * 10, 1)
    shown = int(re.search(r'당 ([\d,]+)원', x['쿠팡표기단가']).group(1).replace(',', ''))
    verdict = '일치' if abs(calc - shown) <= 2 else f'불일치(쿠팡은 {x["용량_원문"]} 1개 기준 계산)'
    bigo = []
    if x.get('배지'): bigo.append(f"배지: {x['배지']}")
    if x.get('정가'): bigo.append(f"정가 {x['정가']:,}원 / 할인 {x['할인율']}%")
    bigo.append('쿠팡URL 미확보 — 캡쳐가 모바일 앱 화면이라 주소 미노출. 확장프로그램 검색 단계에서 채울 것')
    rows.append([
        d['조사일자'], d['채널'], d['카테고리'], x['원본파일명'], x['브랜드명'], x['제품명'], None,
        x['판매가'], x['용량_원문'], x['구성_원문'], x['총용량'], x['단위'], calc, d['단가기준'],
        x['쿠팡표기단가'], verdict, x['제품형태'], role(x), x['순위'], f"유아치약 구매 {x['순위']}위",
        x['리뷰수'], x['월구매자수'], x['구매자수_원문'], x['판매가'] * x['월구매자수'] * 2,
        f"{x['제품형태']} 포장, 구성 {x['구성_원문']}", ' / '.join(bigo), None,
    ])

wb = openpyxl.Workbook()
ws = wb.active; ws.title = '유아치약'
ws.append(HDR)
for r in rows: ws.append(r)

head = Font(bold=True, color='FFFFFF'); fill = PatternFill('solid', fgColor='4472C4')
for c in ws[1]:
    c.font = head; c.fill = fill; c.alignment = Alignment(horizontal='center', vertical='center')
ws.freeze_panes = 'A2'
widths = [11,7,10,34,14,54,38,11,11,20,9,6,13,10,16,24,9,10,6,16,9,13,26,15,30,60,14]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
blank = PatternFill('solid', fgColor='FFF2CC')
for r in range(2, ws.max_row + 1):
    ws.cell(r, 7).fill = blank          # 쿠팡URL 미확보 표시

# 요약 시트
s = wb.create_sheet('요약')
unit = sorted(round(x['판매가'] / x['총용량'] * 10, 1) for x in P)
rev = sum(x['리뷰수'] for x in P); sales = sum(x['판매가'] * x['월구매자수'] * 2 for x in P)
s.append(['카테고리','단가기준','제품수','최저단가','중앙단가','최고단가','추정월매출합','리뷰합','최고대비최저배수'])
s.append([d['카테고리'], d['단가기준'], len(P), unit[0], unit[len(unit)//2], unit[-1], sales, rev,
          round(unit[-1] / unit[0], 1)])
for c in s[1]:
    c.font = head; c.fill = fill; c.alignment = Alignment(horizontal='center')
for i, w in enumerate([12,10,8,11,11,11,16,11,16], 1):
    s.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

out = '/home/user/new_PD_PS/쿠팡_유아치약_25개_제품목록.xlsx'
wb.save(out); print('saved', out)

# 확장프로그램 검색목록
sl = [{'id': f"유아치약-{x['순위']:02d}", 'cat': '유아치약', 'brand': x['브랜드명'],
       'name': x['제품명'].split(',')[0].strip(), 'query': x['제품명'].split(',')[0].strip(),
       'price': x['판매가'], 'size': x['용량_원문'], 'count': x['구성_원문'].split('(')[0].strip(),
       'listName': '유아치약'} for x in P]
p = '/home/user/new_PD_PS/data/순위/유아치약_검색목록.json'
json.dump(sl, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('saved', p, len(sl))
