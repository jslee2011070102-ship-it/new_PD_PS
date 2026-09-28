#!/usr/bin/env python3
"""번호만 누르면 되는 한글 메뉴.

왜 배치파일이 아니라 파이썬인가
------------------------------
cmd.exe는 .bat 파일을 OEM 코드페이지(한국어 윈도우면 949)로 읽는다.
UTF-8로 저장한 .bat에 한글이 들어 있으면 첫 한글 바이트에서 해석이 깨지고,
창이 아무 말 없이 즉시 닫힌다(실제로 그렇게 실패했다).

그래서 .bat은 영어만 쓰고, 한글은 전부 여기로 옮겼다. 파이썬은 파일을
UTF-8로 읽고 출력 인코딩도 스스로 처리하므로 이 문제가 없다.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "capture_coupang.py"

# 콘솔이 못 그리는 글자가 하나라도 있으면 프로그램이 죽는다. 그건 과한 대가이므로
# 표시할 수 없는 글자는 물음표로 바꾸고 계속 진행한다.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(errors="replace")
    except Exception:
        pass

LINE = "=" * 60


def say(*a):
    try:
        print(*a)
    except Exception:
        print(*(str(x).encode("ascii", "replace").decode() for x in a))


def run(*args, capture_to: Path | None = None) -> int:
    """capture_coupang.py 를 실행한다. 실패해도 메뉴로 돌아온다."""
    cmd = [sys.executable, str(SCRIPT), *args]
    say()
    if capture_to is None:
        return subprocess.call(cmd, env=dict(os.environ, PYTHONIOENCODING="utf-8",
                                             PYTHONUTF8="1"))
    # probe 결과는 그대로 전달해야 하므로 화면과 파일에 동시에 남긴다
    # 자식이 파이프로 출력할 때 한국어 윈도우 기본값은 cp949 다. 여기서 utf-8 로
    # 읽으면 한글이 깨진다(실제로 깨졌다). 자식에게 utf-8 로 쓰라고 지정한다.
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace",
                         bufsize=1, env=env)
    lines = []
    assert p.stdout is not None
    for line in p.stdout:
        say(line.rstrip())
        lines.append(line)
    p.wait()
    capture_to.write_text("".join(lines), encoding="utf-8")
    return p.returncode


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return "0"


def pause():
    say()
    ask("Enter 를 누르면 메뉴로 돌아갑니다. ")


def menu():
    if not SCRIPT.is_file():
        say(f"[!] {SCRIPT.name} 을 찾을 수 없습니다.")
        say("    압축을 전부 풀었는지 확인해 주세요.")
        pause()
        return

    while True:
        say()
        say(LINE)
        say("  무엇을 할까요?  번호를 누르고 Enter")
        say(LINE)
        say()
        say("   1. 점검       쿠팡 접속 없이, 저장 기능이 되는지만 확인")
        say("   2. 로그인     브라우저를 열어 쿠팡에 로그인 (한 번만)")
        say("   3. 시험       상품 1개로 시험   <-- 먼저 이것부터")
        say("   4. 수집 5개   실제 수집 (맛보기)")
        say("   5. 수집 전체  실제 수집 (남은 것 전부)")
        say("   6. 진행확인   어디까지 받았는지 보기")
        say("   7. 주소저장   받아온 상품 주소를 자료에 채우기")
        say()
        say("   0. 끝내기")
        say()
        sel = ask("번호: ")

        if sel == "0":
            return

        elif sel == "1":
            say("\n--- 점검 시작 ---")
            run("selftest")
            say()
            say('  위에 "PDF 성공" 이 보이면 저장 기능은 정상입니다.')
            say("  이제 3번(시험)으로 넘어가세요.")
            pause()

        elif sel == "2":
            say("\n--- 브라우저를 엽니다 ---")
            say("  쿠팡 창이 뜨면 로그인하세요.")
            say("  끝나면 이 창으로 돌아와 Enter 를 누르세요.")
            run("login")
            pause()

        elif sel == "3":
            q = ask("검색할 제품명 (그냥 Enter 누르면 기본 제품): ")
            if not q:
                q = "허니맘 캡슐세제 캡슐세탁세제 라벤더향 캡슐 세제"
            say(f"\n--- 시험 시작: {q} ---")
            say("  브라우저가 뜨고 알아서 움직입니다. 건드리지 말고 지켜보세요.")
            out = HERE / "probe결과.txt"
            run("probe", "--query", q, capture_to=out)
            say()
            say(LINE)
            say("  위 내용이 아래 파일로도 저장됐습니다.")
            say(f"  {out}")
            say()
            say("  이 파일을 Claude 에게 보내주세요.")
            say(LINE)
            pause()

        elif sel == "4":
            say("\n--- 수집 시작 (5개) ---")
            say("  상품 하나당 20~40초씩 쉬면서 진행합니다. 3~5분 걸립니다.")
            run("run", "--limit", "5")
            pause()

        elif sel == "5":
            say()
            say("  전체 150개를 받습니다. 1시간 20분 정도 걸립니다.")
            say("  중간에 꺼도 됩니다. 다시 5번을 누르면 이어서 받습니다.")
            if ask("정말 시작할까요? (y 입력): ").lower() != "y":
                continue
            run("run")
            pause()

        elif sel == "6":
            run("status")
            pause()

        elif sel == "7":
            run("export-urls", "--dry-run")
            say()
            if ask("위와 같이 채울까요? (y 입력): ").lower() == "y":
                run("export-urls")
            pause()

        else:
            say("  그런 번호는 없습니다.")


if __name__ == "__main__":
    try:
        menu()
    except Exception as e:
        say()
        say("[!] 예기치 않은 오류가 났습니다:")
        say(f"    {type(e).__name__}: {e}")
        say()
        say("    이 내용을 그대로 Claude 에게 보내주세요.")
        ask("Enter 로 종료 ")
