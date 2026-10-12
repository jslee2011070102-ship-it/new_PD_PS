#!/usr/bin/env python3
"""HTML 에 쓰인 글자만 추려 Pretendard 를 파일 안에 심는다.

왜: HTML 파일 하나만 주고받을 때 CDN 이 막힌 환경에서도 글꼴이 유지되게
하려고. 파일 안에 글꼴이 들어 있으면 인터넷 없이 열어도 똑같이 보인다.

주의 — 이 스크립트를 처음 쓴 이유는 "PDF 에 Pretendard 가 안 들어간다"
였는데, 그건 **오진이었다**. PDF 의 글꼴 목록을 읽으면 LiberationSans /
WenQuanYiZenHei 만 나오지만, 실제로 쪽을 그림으로 떠서 보면 예전 PDF 도
Pretendard 로 그려져 있었다. Chromium 이 글꼴을 이름 없는 Type3 로 심어서
목록 읽기가 헛다리를 짚은 것이다. **PDF 글꼴 목록은 근거가 못 된다.
확인하려면 쪽을 그림으로 떠서 눈으로 봐야 한다.**

전체 글꼴은 2MB 라 그대로 심으면 HTML 이 2.8MB 가 된다. 문서에 실제로
쓰인 글자만 남기면 100KB 안팎으로 줄어든다.

쓰는 법: python3 문서생성/폰트_심기.py <원본.woff2> <대상.html>
"""
import base64, io, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

SRC, HTML = sys.argv[1], sys.argv[2]
html = open(HTML, encoding='utf-8').read()

# 태그와 속성을 걷어낸 '보이는 글자'만 모은다. 넉넉히 남기려고
# 기본 라틴·숫자·문장부호는 무조건 포함한다.
visible = re.sub(r'<(script|style)[\s\S]*?</\1>', ' ', html)
visible = re.sub(r'<[^>]+>', ' ', visible)
chars = set(visible)
chars |= set(' 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
             '.,:;!?()[]{}<>/\\|-–—_+=*&%#@~^`\'"’‘“”…·×÷±°㎜㎝㎏㎖ℓ')
chars = {c for c in chars if c.strip() or c == ' '}

font = TTFont(SRC)
opts = subset.Options(layout_features='*', notdef_outline=True, recalc_bounds=True)
opts.flavor = 'woff2'
sub = subset.Subsetter(options=opts)
sub.populate(text=''.join(sorted(chars)))
sub.subset(font)
buf = io.BytesIO()
font.flavor = 'woff2'
font.save(buf)
data = buf.getvalue()
b64 = base64.b64encode(data).decode()

face = ("  @font-face{font-family:'Pretendard Variable';font-style:normal;"
        "font-weight:45 920;font-display:block;"
        f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}\n")

# CDN link 를 지우고 @font-face 를 <style> 맨 앞에 넣는다.
html = re.sub(r'\s*<link rel="stylesheet" href="https://cdn\.jsdelivr\.net[^>]*>\n?', '\n', html)
assert '<style>' in html
html = html.replace('<style>', '<style>\n' + face, 1)
open(HTML, 'w', encoding='utf-8').write(html)

print(f'글자 {len(chars)}자 / 글꼴 {len(data)/1024:.0f}KB '
      f'(원본 {len(open(SRC,"rb").read())/1024/1024:.1f}MB) / HTML {len(html)/1024:.0f}KB')
