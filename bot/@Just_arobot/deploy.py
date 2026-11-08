"""Deploy Just_arobot to Telegram Serverless.

Usage (run inside bot/Just_arobot/):
    python deploy.py          # npx tgcloud push
    python deploy.py --migrate  # push + migrate
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(*args: str) -> int:
    # shell=True on Windows so npx.cmd resolves in every terminal.
    p = subprocess.run(list(args), cwd=HERE, shell=True)
    return p.returncode


def main() -> int:
    if run("npx", "tgcloud", "push") != 0:
        return 1
    if "--migrate" in sys.argv[1:]:
        return run("npx", "tgcloud", "migrate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
