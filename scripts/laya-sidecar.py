"""Laya sidecar for Rich AI Chat's component-selection gate (roadmap M3).

A small long-lived process the Next server starts lazily (src/lib/laya-gate.ts). It reuses pi-local-harness's
typed-decision wrapper, `harness.laya.Classifier`, unchanged: the pinned laya-mlx runtime, the offline model, and the
rule that missing runtime, invalid output or low confidence always abstains. It never downloads anything.

Protocol: JSON lines over stdio.
  out, once at start: {"ready": true, "installed": bool, "pinned": bool}
  in:  {"id": 1, "kind": "choice", "state": {...}, "question": "...", "options": [...], "min_confidence": 0.9}
  out: {"id": 1, "answer": "chart" | null, "confidence": 0.97, "abstained": false, "ms": 9.4}
       {"id": 1, "unavailable": true, "reason": "not-installed" | "not-pinned"}
  in:  {"id": 2, "warm": true}  loads the model now so the first real question is fast
       {"id": 2, "warm": true, "ms": 2100.0}

Arguments: --plh <pi-local-harness checkout> --sha256 <expected sha256 of harness/laya.py> [--data <data folder>]
The checkout's harness/laya.py must match the pinned hash, or every question reports "not-pinned".
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plh', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--data')
    args = parser.parse_args()
    module = Path(args.plh) / 'harness' / 'laya.py'
    pinned = module.is_file() and hashlib.sha256(module.read_bytes()).hexdigest() == args.sha256
    classifier = None
    installed = False
    if pinned:
        sys.path.insert(0, str(Path(args.plh).resolve()))
        from harness.laya import Classifier
        classifier = Classifier(data=args.data) if args.data else Classifier()
        installed = classifier.available()

    def send(value):
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    send({'ready': True, 'installed': installed, 'pinned': pinned})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            ident = request.get('id')
        except Exception:
            continue
        if not pinned or not installed:
            send({'id': ident, 'unavailable': True, 'reason': 'not-pinned' if not pinned else 'not-installed'})
            continue
        started = time.perf_counter()
        try:
            if request.get('warm'):
                classifier.ask('noul', {'message': 'warm up'}, 'The message is a greeting.', min_confidence=1)
                send({'id': ident, 'warm': True, 'ms': round((time.perf_counter() - started) * 1000, 1)})
                continue
            result = classifier.ask(request['kind'], request['state'], request['question'], request.get('options'),
                                    request.get('min_confidence', .95))
            send({'id': ident, **result, 'ms': round((time.perf_counter() - started) * 1000, 1)})
        except Exception:
            # A malformed question is the caller's bug; never echo the state back.
            send({'id': ident, 'error': 'invalid-question'})


if __name__ == '__main__':
    main()
