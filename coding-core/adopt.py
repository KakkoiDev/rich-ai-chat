#!/usr/bin/env python3
"""Adopt coding-core's self-contained JavaScript modules in another repository, pinned to this commit.

  python3 tools/adopt.py TARGET_REPO [--update] [--dry-run]
  python3 TARGET_REPO/coding-core/adopt.py --verify TARGET_REPO/coding-core     # in the adopting repo's checks

Writes into TARGET_REPO/coding-core/:

  js/task-states.mjs, js/sqlite.mjs, js/receipts.mjs   the modules (Node built-ins only, no vendored Lodash)
  LICENSE                                              coding-core's MIT licence
  adopt.py                                             this script, for --verify
  MANIFEST.json                                        the commit and every copied file's sha256
  README.md                                            how the copy is used here (written once, then the project's)

The copied files are coding-core's: a second run refuses to change them unless --update, and --verify fails when
someone edited them in place (change coding-core, then --update). The project's README.md is never overwritten.
Same layout and rules as test-core's adopt.py. Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/KakkoiDev/coding-core"
FOLDER = "coding-core"
MODULES = ["js/task-states.mjs", "js/sqlite.mjs", "js/receipts.mjs"]
README = """# coding-core in this repository

A pinned copy of [coding-core](https://github.com/KakkoiDev/coding-core)'s self-contained JavaScript modules (the
commit is in `MANIFEST.json`). Do not edit `js/` here: change coding-core, then run its
`tools/adopt.py THIS_REPO --update`. This README is the project's.

- `js/task-states.mjs`: guarded transition table (`transition`, `allowedEvents`, `taskTransitions`, `hasEvidence`).
- `js/sqlite.mjs`: `openDatabase`, `transaction`, `migrate` over node:sqlite (Node 22.13+).
- `js/receipts.mjs`: idempotent operation receipts (`operationKey`, `createReceipts`).

Check the copy: `python3 coding-core/adopt.py --verify coding-core`.
"""


def library_files() -> dict[str, bytes]:
    """Published path (inside coding-core/) -> content, for every file coding-core owns in the copy."""
    files = {path: (ROOT / path).read_bytes() for path in MODULES}
    files["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    files["adopt.py"] = Path(__file__).resolve().read_bytes()
    return files


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def commit() -> str:
    try:
        sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True,
                             check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", *MODULES, "LICENSE",
                                "tools/adopt.py"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return f"{sha}+local-changes" if dirty else sha


def adopt(target: Path, *, update: bool = False, dry_run: bool = False) -> list[str]:
    """Copy the modules into target. Returns what it did, one line each. Raises SystemExit on a refused change."""
    if not target.is_dir():
        raise SystemExit(f"{target} is not a folder")
    base = target / FOLDER
    library = library_files()
    manifest = {"coding-core": REPOSITORY, "commit": commit(),
                "files": {path: sha256(data) for path, data in sorted(library.items())}}
    library["MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    old_manifest = base / "MANIFEST.json"
    previous = json.loads(old_manifest.read_text(encoding="utf-8"))["files"] if old_manifest.is_file() else {}
    changes = [path for path, data in library.items()
               if path != "MANIFEST.json" and (base / path).is_file() and (base / path).read_bytes() != data]
    if changes and not update:
        listed = "\n  ".join(changes)
        raise SystemExit(f"coding-core is already in {target} and these files differ:\n  {listed}\n"
                         "Run again with --update to replace coding-core's own files (the project's files stay).")
    done = []
    for path, data in sorted(library.items()):
        target_path = base / path
        if target_path.is_file() and target_path.read_bytes() == data:
            continue
        done.append(f"{'update' if target_path.exists() else 'add'} {FOLDER}/{path}")
        if not dry_run:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(data)
    for path in sorted(set(previous) - set(library)):  # files this version no longer ships
        if (base / path).is_file():
            done.append(f"remove {FOLDER}/{path}")
            if not dry_run:
                (base / path).unlink()
    readme = base / "README.md"
    if readme.exists():
        done.append(f"keep {FOLDER}/README.md (the project's)")
    else:
        done.append(f"add {FOLDER}/README.md")
        if not dry_run:
            readme.parent.mkdir(parents=True, exist_ok=True)
            readme.write_text(README, encoding="utf-8")
    return done


def verify(base: Path) -> list[str]:
    """Problems with an adopted copy: files edited in place or missing (MANIFEST.json says what was copied)."""
    manifest_path = base / "MANIFEST.json"
    if not manifest_path.is_file():
        return [f"{manifest_path} is missing: adopt coding-core with tools/adopt.py"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    problems = []
    for path, digest in manifest["files"].items():
        file = base / path
        if not file.is_file():
            problems.append(f"missing: {FOLDER}/{path}")
        elif sha256(file.read_bytes()) != digest:
            problems.append(f"edited in place: {FOLDER}/{path} (change coding-core, then adopt.py --update)")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("target", type=Path, nargs="?", help="the repository to adopt coding-core in")
    parser.add_argument("--update", action="store_true", help="replace coding-core's own files with this version")
    parser.add_argument("--dry-run", action="store_true", help="print what would change, change nothing")
    parser.add_argument("--verify", type=Path, metavar="CODING_CORE_FOLDER", help="check an adopted copy")
    args = parser.parse_args(argv)
    if args.verify:
        problems = verify(args.verify)
        manifest = args.verify / "MANIFEST.json"
        pinned = json.loads(manifest.read_text())["commit"] if manifest.is_file() else "?"
        for problem in problems:
            print(problem)
        print(f"coding-core {pinned}: " + ("every file as copied." if not problems else f"{len(problems)} problem(s)."))
        return 1 if problems else 0
    if args.target is None:
        parser.error("give the repository to adopt coding-core in, or --verify FOLDER")
    for line in adopt(args.target, update=args.update, dry_run=args.dry_run):
        print(line)
    print(f"coding-core {commit()} {'would be' if args.dry_run else 'is'} in {args.target / FOLDER}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
