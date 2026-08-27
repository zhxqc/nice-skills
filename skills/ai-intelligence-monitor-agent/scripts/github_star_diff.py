#!/usr/bin/env python3
"""Calculate deterministic GitHub star differences between saved snapshots."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_snapshot(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        snapshot = json.load(handle)
    if not isinstance(snapshot.get("repositories"), dict):
        raise ValueError(f"{path}: repositories must be an object")
    parse_time(snapshot["captured_at"])
    for name, metadata in snapshot["repositories"].items():
        stars = metadata.get("stars")
        if not isinstance(stars, int) or stars < 0:
            raise ValueError(f"{path}: {name}.stars must be a non-negative integer")
    return snapshot


def calculate(previous: dict[str, Any], current: dict[str, Any], top: int | None) -> dict[str, Any]:
    start = parse_time(previous["captured_at"])
    end = parse_time(current["captured_at"])
    hours = (end - start).total_seconds() / 3600
    if hours <= 0:
        raise ValueError("current snapshot must be newer than previous snapshot")

    results: list[dict[str, Any]] = []
    previous_repos = previous["repositories"]
    for name, metadata in current["repositories"].items():
        row: dict[str, Any] = {
            "repository": name,
            "current_stars": metadata["stars"],
            "created_at": metadata.get("created_at"),
            "pushed_at": metadata.get("pushed_at"),
            "license": metadata.get("license"),
        }
        if name not in previous_repos:
            row.update({"status": "no_baseline", "added_stars": None, "growth_rate_pct": None})
        else:
            old_stars = previous_repos[name]["stars"]
            delta = metadata["stars"] - old_stars
            growth = None if old_stars == 0 else round(delta / old_stars * 100, 4)
            row.update(
                {
                    "status": "exact_snapshot_delta",
                    "previous_stars": old_stars,
                    "added_stars": delta,
                    "growth_rate_pct": growth,
                }
            )
        results.append(row)

    results.sort(
        key=lambda row: (
            row["added_stars"] is not None,
            row["added_stars"] if row["added_stars"] is not None else -1,
            row["repository"],
        ),
        reverse=True,
    )
    if top is not None:
        results = results[:top]

    return {
        "window": {
            "start": previous["captured_at"],
            "end": current["captured_at"],
            "hours": round(hours, 4),
            "approximately_24h": 23 <= hours <= 25,
        },
        "repositories": results,
    }


def self_test() -> None:
    previous = {
        "captured_at": "2026-08-26T09:15:00+08:00",
        "repositories": {"example/repo": {"stars": 100}},
    }
    current = {
        "captured_at": "2026-08-27T09:15:00+08:00",
        "repositories": {
            "example/repo": {"stars": 125, "license": "MIT"},
            "new/repo": {"stars": 10},
        },
    }
    result = calculate(previous, current, None)
    assert result["window"]["approximately_24h"] is True
    assert result["repositories"][0]["added_stars"] == 25
    assert result["repositories"][0]["growth_rate_pct"] == 25.0
    assert result["repositories"][1]["status"] == "no_baseline"
    print("self-test passed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", type=Path, help="previous snapshot JSON")
    parser.add_argument("--current", type=Path, help="current snapshot JSON")
    parser.add_argument("--output", type=Path, help="write result JSON instead of stdout")
    parser.add_argument("--top", type=int, help="return only the top N repositories")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if not args.previous or not args.current:
        parser.error("--previous and --current are required unless --self-test is used")
    if args.top is not None and args.top <= 0:
        parser.error("--top must be positive")

    try:
        result = calculate(load_snapshot(args.previous), load_snapshot(args.current), args.top)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
