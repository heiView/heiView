"""Atomic task journals. A failed course stays pending until it succeeds."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from uuid import uuid4

from crawler.config import DATA_DIR, LOCAL_TIMEZONE, SEMESTERS


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.' + path.name, suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def save_task(task: dict, data_dir: Path = DATA_DIR, *, crawl_activity: bool = True) -> None:
    task['updatedAt'] = timestamp()
    if crawl_activity:
        task['lastCrawlTime'] = task['updatedAt']
    atomic_json(data_dir / task['options']['semester'] / 'checkpoint.json', task)


def new_task(options) -> dict:
    return {
        'version': 1, 'id': uuid4().hex, 'options': asdict(options),
        'termId': SEMESTERS[options.semester],
        'startedAt': timestamp(), 'lastCrawlTime': timestamp(),
        'crawlStatus': 'running', 'syncStatus': 'not_started',
        'nextSkip': options.skip if not options.reverse else None,
        'pagePending': [], 'retries': [], 'urlPending': list(dict.fromkeys(options.url)),
        'selectedIds': [], 'successes': {}, 'expectedFilenames': [],
        'traversalFinished': False, 'pagesVisited': 0,
    }


def load_task(semester: str, data_dir: Path = DATA_DIR) -> dict | None:
    path = data_dir / semester / 'checkpoint.json'
    if not path.exists():
        return None
    try:
        task = json.loads(path.read_text(encoding='utf-8'))
        if (not isinstance(task, dict) or task.get('version') != 1 or task['options']['semester'] != semester
                or task['termId'] != SEMESTERS[semester]
                or task['crawlStatus'] not in {'running', 'interrupted', 'failed', 'completed'}
                or task['syncStatus'] not in {'not_started', 'running', 'failed', 'interrupted', 'completed'}
                or not isinstance(task['successes'], dict)
                or not isinstance(task['selectedIds'], list)
                or not isinstance(task['pagePending'], list)
                or not isinstance(task['retries'], list)
                or not isinstance(task['urlPending'], list)):
            raise ValueError('Checkpoint structure or semester configuration does not match')
        from crawler.heico_crawler import CrawlOptions
        options = dict(task['options'])
        options['url'] = tuple(options.get('url', ()))
        CrawlOptions(**options).validate()
        when = datetime.fromisoformat(task['lastCrawlTime'])
        if when.tzinfo is None:
            raise ValueError('Checkpoint timestamp is missing timezone information')
        cursor = task['nextSkip']
        if cursor is not None and (not isinstance(cursor, int) or (cursor < 0 and not task['traversalFinished'])):
            raise ValueError('Invalid pagination position')
        for entry in task['pagePending'] + task['retries']:
            if not isinstance(entry, dict) or not isinstance(entry.get('course_id'), str):
                raise ValueError('Invalid pending course record')
        for result in task['successes'].values():
            if (not isinstance(result, dict) or not isinstance(result.get('filename'), str)
                    or Path(result['filename']).name != result['filename']):
                raise ValueError('Invalid successful course record')
        if not isinstance(task['expectedFilenames'], list) or not isinstance(task['traversalFinished'], bool):
            raise ValueError('Invalid crawl coverage metadata')
        when.astimezone(LOCAL_TIMEZONE)
        return task
    except (ValueError, KeyError, TypeError, OSError, AttributeError) as exc:
        raise ValueError(f'Cannot use checkpoint {path}: {exc}') from exc


def can_resume(task: dict, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    when = datetime.fromisoformat(task['lastCrawlTime'])
    return (task['crawlStatus'] in {'running', 'interrupted', 'failed'}
            and when.astimezone(LOCAL_TIMEZONE).date() == current.astimezone(LOCAL_TIMEZONE).date())
