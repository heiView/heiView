"""Small standard-library CLI menu; crawler execution lives in heico_crawler."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from typing import Callable

from crawler.config import DATA_DIR, DEFAULT_SEMESTER, SEMESTERS
from crawler.heico_crawler import CrawlOptions, crawl_courses
from crawler.checkpoint import can_resume, load_task
from crawler.database import sync_database


class Back(Exception):
    pass


class ExitMenu(Exception):
    pass


@dataclass(frozen=True)
class SavedTaskAction:
    options: CrawlOptions
    sync_only: bool = False


def offer_saved_task(semester: str) -> SavedTaskAction | None:
    try:
        task = load_task(semester)
    except ValueError as exc:
        print(exc)
        print('该断点无法恢复；可以配置新任务。')
        return None
    if task is None:
        return None
    options = dict(task['options'])
    options['url'] = tuple(options.get('url', ()))
    saved = CrawlOptions(**options)
    if can_resume(task):
        print(f'\n发现当天未完成任务：{semester}，{"倒序" if saved.reverse else "顺序"}，'
              f'已成功 {len(task["successes"])} 门，下一页偏移 {task["nextSkip"]}，'
              f'待处理/重试 {len(task["pagePending"]) + len(task["retries"]) + len(task["urlPending"])} 项。')
        print(f'原任务参数：数量上限 {saved.number or "不限"}，初始跳过 {saved.skip}，'
              f'并发 {saved.concurrency}，显示浏览器 {saved.show_browser}，URL {list(saved.url)}')
        print(f'开始于 {task["startedAt"]}；最近爬取 {task["lastCrawlTime"]}。')
        choice = choose('处理上次任务', [('resume', '从断点继续'), ('new', '重新配置新任务'),
                                      ('menu', '返回菜单')], 'resume')
        if choice == 'resume':
            return SavedTaskAction(saved)
        if choice == 'menu':
            raise Back
    elif task['crawlStatus'] == 'completed' and task['syncStatus'] != 'completed':
        choice = choose('上次爬取已完成，数据库尚未同步成功',
                        [('sync', '只重试数据库同步'), ('new', '配置新爬取任务'), ('menu', '返回菜单')], 'sync')
        if choice == 'sync':
            return SavedTaskAction(saved, sync_only=True)
        if choice == 'menu':
            raise Back
    elif task['crawlStatus'] != 'completed':
        print('上次任务不在同一天（Europe/Berlin），不使用旧断点。')
    return None


def read_input(prompt: str) -> str:
    value = input(prompt).strip()
    if value.lower() in {'b', 'back', '返回'}:
        raise Back
    if value.lower() in {'q', 'quit', 'exit', '退出'}:
        raise ExitMenu
    return value


def choose(label: str, choices: list[tuple[str, str]], default: str) -> str:
    print(f'\n{label}')
    for index, (value, title) in enumerate(choices, 1):
        print(f'  {index}. {title}{"（默认）" if value == default else ""}')
    while True:
        answer = read_input('输入编号或选项名称，回车使用默认值：')
        if not answer:
            return default
        for index, (value, _title) in enumerate(choices, 1):
            if answer == str(index) or answer.lower() == value.lower():
                return value
        print('无效选项，请重新输入。')


def semester_choices() -> list[tuple[str, str]]:
    semesters = sorted(SEMESTERS, key=lambda key: (int(key[:4]), key[4:] == 'WS'), reverse=True)
    return [(key, key) for key in semesters]


def integer(label: str, default: int | None, *, minimum: int, optional: bool = False) -> int | None:
    default_text = '不限' if default is None else str(default)
    while True:
        answer = read_input(f'{label} [默认：{default_text}]：')
        if not answer:
            return default
        if optional and answer.lower() in {'all', 'none', '不限'}:
            return None
        try:
            value = int(answer)
            if value >= minimum:
                return value
        except ValueError:
            pass
        print(f'请输入不小于 {minimum} 的整数。' + (' 输入 all 表示不限。' if optional else ''))


def yes_no(label: str, default: bool) -> bool:
    while True:
        answer = read_input(f'{label} [y/n，默认：{"y" if default else "n"}]：').lower()
        if not answer:
            return default
        if answer in {'y', 'yes', '是', '1'}:
            return True
        if answer in {'n', 'no', '否', '0'}:
            return False
        print('请输入 y 或 n。')


def course_urls(default: tuple[str, ...]) -> tuple[str, ...]:
    print('指定 URL 模式只使用学期、并发数和浏览器选项；不使用方向、数量或偏移量。')
    print('课程将保存到所选学期，请确保详情 URL 属于该学期。')
    if default:
        print('当前 URL：' + ' '.join(default))
    while True:
        answer = read_input('课程详情 URL（多个用空格分隔，回车保留当前值）：')
        urls = tuple(answer.split()) if answer else default
        if not urls:
            print('请至少输入一个课程详情 URL。')
            continue
        try:
            CrawlOptions(url=urls).validate()
            return urls
        except ValueError as exc:
            print(f'URL 无效：{exc}')


def configure_crawl() -> CrawlOptions | SavedTaskAction | None:
    draft = {
        'semester': DEFAULT_SEMESTER, 'mode': 'list', 'reverse': False,
        'number': None, 'skip': 0, 'concurrency': 5,
        'show_browser': False, 'url': (),
    }
    index = 0
    print('\n配置爬取任务。每一步都可输入 b 返回上一步，q 退出菜单。')
    while True:
        steps = ['semester', 'mode']
        if draft['mode'] == 'list':
            steps += ['reverse', 'number', 'skip']
        steps += ['concurrency', 'show_browser']
        if draft['mode'] == 'urls':
            steps += ['url']
        try:
            if index < len(steps):
                step = steps[index]
                if step == 'semester':
                    draft[step] = choose('选择学期', semester_choices(), draft[step])
                    saved_action = offer_saved_task(draft[step])
                    if saved_action is not None:
                        return saved_action
                elif step == 'mode':
                    draft[step] = choose('爬取方式', [('list', '爬取课程列表'), ('urls', '按详情 URL 重新爬取')], draft[step])
                elif step == 'reverse':
                    direction = choose('遍历方向', [('forward', '顺序：从列表开头向后'), ('reverse', '倒序：从列表末尾向前')],
                                       'reverse' if draft[step] else 'forward')
                    draft[step] = direction == 'reverse'
                elif step == 'number':
                    draft[step] = integer('爬取数量上限（输入 all 表示不限）', draft[step], minimum=1, optional=True)
                elif step == 'skip':
                    position = '末尾' if draft['reverse'] else '开头'
                    draft[step] = integer(f'从列表{position}跳过多少门课程', draft[step], minimum=0)
                elif step == 'concurrency':
                    draft[step] = integer('并发数', draft[step], minimum=1)
                elif step == 'show_browser':
                    draft[step] = yes_no('是否显示浏览器', draft[step])
                elif step == 'url':
                    draft[step] = course_urls(draft[step])
                index += 1
                continue

            # Unused list/URL settings are excluded when switching modes.
            options = CrawlOptions(
                semester=draft['semester'], concurrency=draft['concurrency'],
                show_browser=draft['show_browser'],
                url=draft['url'] if draft['mode'] == 'urls' else (),
                reverse=draft['reverse'] if draft['mode'] == 'list' else False,
                number=draft['number'] if draft['mode'] == 'list' else None,
                skip=draft['skip'] if draft['mode'] == 'list' else 0,
            )
            options.validate()
            print('\n任务摘要')
            print(f'  学期：{options.semester}')
            print(f'  输出目录：{DATA_DIR / options.semester}')
            if options.url:
                print('  模式：按 URL 重新爬取')
                for url in options.url:
                    print(f'    {url}')
            else:
                print(f'  方向：{"倒序" if options.reverse else "顺序"}')
                print(f'  数量上限：{options.number if options.number is not None else "不限"}')
                print(f'  跳过数量：{options.skip}（从{"末尾" if options.reverse else "开头"}计数）')
            print(f'  并发数：{options.concurrency}；显示浏览器：{"是" if options.show_browser else "否"}')
            print('  r/1 执行，e/2 修改，b 返回上一步，menu 返回主菜单，q 退出。')
            answer = read_input('选择操作：').lower()
            if answer in {'r', 'run', '1'}:
                return options
            if answer in {'e', 'edit', '2'}:
                index = 0
            elif answer in {'menu', 'cancel'}:
                return None
            else:
                print('请输入 r、e、b、menu 或 q。')
        except Back:
            if index == 0:
                return None
            index -= 1


def run_crawl() -> None:
    options = configure_crawl()
    if isinstance(options, SavedTaskAction):
        if options.sync_only:
            asyncio.run(sync_database(options.options.semester))
        else:
            asyncio.run(crawl_courses(options.options, resume=True))
    elif options is not None:
        asyncio.run(crawl_courses(options))


def run_database_sync() -> None:
    try:
        semester = choose('选择要同步的学期', semester_choices(), DEFAULT_SEMESTER)
        print(f'数据目录：{DATA_DIR / semester}')
        print(f'HEIVIEW_SEMESTER={semester} npm run db:sync')
        if yes_no('执行数据库同步', False):
            asyncio.run(sync_database(semester))
    except Back:
        return


@dataclass(frozen=True)
class Operation:
    name: str
    label: str
    handler: Callable[[], None]
    aliases: tuple[str, ...] = ()


# Register future menu operations here.
OPERATIONS = (
    Operation('crawl', '爬取课程', run_crawl, ('c', '爬取课程')),
    Operation('sync', '构建/同步数据库', run_database_sync, ('db', '构建数据库')),
)


def main(argv: list[str] | None = None) -> None:
    argparse.ArgumentParser(description='heiView 交互式命令行菜单（输入编号或命令选择操作）。').parse_args(argv)
    while True:
        print('\nheiView 操作菜单')
        for index, operation in enumerate(OPERATIONS, 1):
            print(f'  {index}. {operation.label} ({operation.name})')
        print('  0. 退出 (q)')
        try:
            answer = read_input('选择操作：').lower()
            if answer == '0':
                raise ExitMenu
        except Back:
            continue
        except (ExitMenu, EOFError, KeyboardInterrupt):
            print('\n已退出 heiView。')
            return

        operation = next((item for index, item in enumerate(OPERATIONS, 1)
                          if answer in (str(index), item.name, *item.aliases)), None)
        if operation is None:
            print('无效操作，请输入菜单编号或命令。')
            continue
        try:
            operation.handler()
        except (ExitMenu, EOFError):
            print('\n已退出 heiView。')
            return
        except KeyboardInterrupt:
            print('\n当前操作已取消，返回主菜单。')
        except Exception as exc:
            print(f'操作失败：{exc}')
            if isinstance(exc, ModuleNotFoundError):
                print('请安装依赖：python -m pip install -r crawler/requirements.txt')
            print('已返回主菜单。')
