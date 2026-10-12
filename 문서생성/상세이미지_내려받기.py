"""수집기록에 남은 이미지 주소로 상세 이미지를 직접 받는다.

사장님이 '이미지 파일은 저장하지 않기'를 켜고 돌리셨다. 그래도 **주소는
기록에 남는다** — 그게 그 설정의 요지다. 그러니 내가 받으면 된다.
사장님이 폴더를 드라이브에 올리실 일이 없다.

브라우저가 페이지 한 장 여는 정도의 속도로 받는다.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import urllib.request

REC = sys.argv[1]
OUT = sys.argv[2]
rec = json.load(open(REC, encoding='utf-8'))

jobs = []
for k in sorted(rec, key=lambda s: int(s.split('-')[1])):
    for i, u in enumerate(rec[k].get('imageUrls') or [], 1):
        ext = '.webp' if u.lower().endswith('.webp') else ('.png' if u.lower().endswith('.png') else '.jpg')
        jobs.append((k, os.path.join(OUT, k, f'{i:02d}{ext}'), u))

for d in {os.path.dirname(p) for _, p, _ in jobs}:
    os.makedirs(d, exist_ok=True)

ok = fail = 0
def get(job):
    global ok, fail
    k, path, url = job
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return
    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            if len(data) < 500:
                raise ValueError(f'너무 작음 {len(data)}B')
            open(path, 'wb').write(data)
            ok += 1
            return
        except Exception as e:
            if attempt == 2:
                fail += 1
                print(f'  실패 {k} {os.path.basename(path)}: {e}')
            time.sleep(1.5 * (attempt + 1))

print(f'받을 것 {len(jobs)}장')
with ThreadPoolExecutor(max_workers=4) as ex:
    list(ex.map(get, jobs))
print(f'성공 {ok} / 실패 {fail}')
