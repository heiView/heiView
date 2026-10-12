"""One database sync path shared by the crawler and the terminal menu."""

from __future__ import annotations

import asyncio
import os
import signal
from pathlib import Path

from crawler.checkpoint import load_task, save_task
from crawler.config import DATA_DIR, PROJECT_ROOT, SEMESTERS


def validate_data(semester: str, data_dir: Path = DATA_DIR) -> None:
    if semester not in SEMESTERS:
        raise ValueError(f'Unknown semester: {semester}')
    course_dir = data_dir / semester
    if (not course_dir.is_dir() or not (any(course_dir.glob('course-*.json'))
                                       or any((course_dir / 'custom').glob('course-*.json')))):
        raise ValueError(f'{semester} 没有可导入的课程数据：{course_dir}')


async def sync_database(semester: str, *, data_dir: Path = DATA_DIR, task: dict | None = None) -> None:
    validate_data(semester, data_dir)
    task = task if task is not None else load_task(semester, data_dir)
    if task:
        task['syncStatus'] = 'running'
        save_task(task, data_dir, crawl_activity=False)
    env = {**os.environ, 'HEIVIEW_SEMESTER': semester, 'HEIVIEW_DATA_DIR': str(data_dir.resolve())}
    print(f'[{semester}] npm run db:sync → {data_dir / (semester + ".db")}', flush=True)
    process = None
    try:
        process = await asyncio.create_subprocess_exec('npm', 'run', 'db:sync', cwd=PROJECT_ROOT, env=env,
                                                      start_new_session=True)
        code = await process.wait()
        if code:
            raise RuntimeError(f'数据库同步失败（退出码 {code}）。可在菜单中只重试数据库同步。')
    except (Exception, asyncio.CancelledError) as exc:
        if process is not None and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            await process.wait()
        if task:
            task['syncStatus'] = 'interrupted' if isinstance(exc, asyncio.CancelledError) else 'failed'
            task['syncError'] = str(exc)
            save_task(task, data_dir, crawl_activity=False)
        raise
    if task:
        task['syncStatus'] = 'completed'
        task.pop('syncError', None)
        save_task(task, data_dir, crawl_activity=False)
    print(f'[{semester}] 数据库同步成功。', flush=True)
