"""Semester registry shared by the crawler and the interactive menu."""

import json
import os
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get('HEIVIEW_DATA_DIR', PROJECT_ROOT / 'data')).resolve()

CONFIG = json.loads((PROJECT_ROOT / 'config' / 'semesters.json').read_text(encoding='utf-8'))
SEMESTERS = {key: value['termId'] for key, value in CONFIG['semesters'].items()}
DEFAULT_SEMESTER = CONFIG['defaultSemester']
LOCAL_TIMEZONE = ZoneInfo(CONFIG['timezone'])

# Preserve the old shared metadata file for consumers of the legacy SS database.
LEGACY_SYNC_SEMESTER = CONFIG['legacySemester']


def semester_for_date(value: str) -> str:
    selected = date.fromisoformat(value)
    if selected.month < CONFIG['summerStartMonth']:
        return f'{selected.year - 1}WS'
    if selected.month < CONFIG['winterStartMonth']:
        return f'{selected.year}SS'
    return f'{selected.year}WS'
