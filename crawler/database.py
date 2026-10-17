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
        raise ValueError(f'No importable course data found for {semester}: {course_dir}')


async def sync_database(semester: str, *, data_dir: Path = DATA_DIR, task: dict | None = None) -> None:
    all_semesters = semester == 'all'
    if all_semesters:
        # The Node sync validates every local semester (including databases
        # whose source directory is missing) before changing shared data.
        tasks = [saved for selected in SEMESTERS if (data_dir / selected).is_dir()
                 if (saved := load_task(selected, data_dir)) is not None]
    else:
        validate_data(semester, data_dir)
        saved = task if task is not None else load_task(semester, data_dir)
        tasks = [saved] if saved is not None else []
    for saved in tasks:
        saved['syncStatus'] = 'running'
        save_task(saved, data_dir, crawl_activity=False)
    env = {**os.environ, 'HEIVIEW_DATA_DIR': str(data_dir.resolve())}
    args = ['npm', 'run', 'db:sync']
    if all_semesters:
        args += ['--', '--all']
    else:
        env['HEIVIEW_SEMESTER'] = semester
    destination = data_dir if all_semesters else data_dir / (semester + '.db')
    print(f'[{semester}] {" ".join(args)} → {destination}', flush=True)
    process = None
    try:
        process = await asyncio.create_subprocess_exec(*args, cwd=PROJECT_ROOT, env=env,
                                                      start_new_session=True)
        code = await process.wait()
        if code:
            raise RuntimeError(f'Database sync failed (exit code {code}). You can retry database sync only from the menu.')
    except (Exception, asyncio.CancelledError) as exc:
        if process is not None and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            await process.wait()
        for saved in tasks:
            saved['syncStatus'] = 'interrupted' if isinstance(exc, asyncio.CancelledError) else 'failed'
            saved['syncError'] = str(exc)
            save_task(saved, data_dir, crawl_activity=False)
        raise
    for saved in tasks:
        saved['syncStatus'] = 'completed'
        saved.pop('syncError', None)
        save_task(saved, data_dir, crawl_activity=False)
    print(f'[{semester}] Database sync completed successfully.', flush=True)


async def sync_all_databases(*, data_dir: Path = DATA_DIR) -> None:
    """Build all local semesters before pruning unused Other buildings."""
    await sync_database('all', data_dir=data_dir)
