"""기획서 HTML 을 PDF 로 찍는다.

쓰는 법:
    (기획서 폴더에서) python3 -m http.server 8743 &
    python3 문서생성/기획서_PDF생성.py "http://localhost:8743/<파일>.html" out.pdf

file:// 로 열면 CDN 글꼴을 못 받아 한글이 기본 글꼴로 떨어진다. http 로 띄운다.
찍은 뒤에는 **PDF 쪽수가 섹션 수와 같은지 반드시 확인**할 것.
브라우저에서 잰 높이는 믿을 게 못 된다 — 여백이 남는다고 나왔는데
실제 PDF 는 18쪽으로 쪼개진 적이 있다. 진짜 기준은 뽑은 PDF 다.

CSS 에 @media print 가 이미 있다(.page 마다 page-break-after:always).
글꼴은 CDN 에서 받으므로 networkidle 까지 기다린다 — 안 기다리면
한글이 기본 글꼴로 떨어져 줄바꿈이 어긋난다.
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], pathlib.Path(sys.argv[2])
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    pg = b.new_page()
    pg.goto(URL, wait_until='networkidle')
    pg.emulate_media(media='print')
    pg.wait_for_timeout(1500)
    # 글꼴이 실제로 적용됐는지 확인한다. 떨어졌으면 PDF 도 깨진다.
    fam = pg.evaluate("getComputedStyle(document.body).fontFamily")
    loaded = pg.evaluate("document.fonts.check('16px \"Pretendard Variable\"')")
    print('글꼴:', fam.split(',')[0], '| Pretendard 적용:', loaded)
    pg.pdf(path=str(OUT), format='A4', print_background=True,
           margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    b.close()
