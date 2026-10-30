"""List every scene_id referenced by src/data/events.json (unique, sorted).

Usage: python3 tools/list_scene_ids.py [--json]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def collect(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get('scene_id'), str):
            yield obj['scene_id']
        for v in obj.values():
            yield from collect(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from collect(v)


def main():
    data = json.loads((ROOT / 'src/data/events.json').read_text())
    ids = sorted(set(collect(data)))
    if '--json' in sys.argv:
        print(json.dumps(ids))
    else:
        for i in ids:
            print(i)
        print(f'COUNT {len(ids)}')


if __name__ == '__main__':
    main()
