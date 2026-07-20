#!/usr/bin/env python3
"""Smoke-test the public Worker and its Chinese policy localization."""

from __future__ import annotations

import json
import urllib.request


BASE_URL = "https://tin-insight-api.wangziquan-tin.workers.dev"


def get_json(path: str) -> dict:
    request = urllib.request.Request(
        BASE_URL + path,
        headers={"User-Agent": "Tin Insight GitHub Actions Smoke Test"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return json.load(response)


def has_chinese(value: object) -> bool:
    return any("\u4e00" <= character <= "\u9fff" for character in str(value or ""))


def main() -> None:
    health = get_json("/health")
    if not health.get("ok") or not health.get("ai_configured"):
        raise RuntimeError(f"Worker health is not ready: {health}")

    policy = get_json("/api/policy?smoke=github")
    items = policy.get("items") or []
    ai_source = (policy.get("sources") or {}).get("WORKERS AI 中文摘要") or {}
    if not items or not ai_source.get("ok"):
        raise RuntimeError(f"Policy AI source failed: {ai_source}")
    if not all(has_chinese(item.get("title_zh")) and has_chinese(item.get("summary_zh")) for item in items):
        raise RuntimeError("Policy feed contains an item without a Chinese title or summary")

    sample = [
        {"title_zh": item["title_zh"], "summary_zh": item["summary_zh"]}
        for item in items[:2]
    ]
    print(json.dumps({"ok": True, "count": len(items), "sample": sample}, ensure_ascii=False))


if __name__ == "__main__":
    main()
