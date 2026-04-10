# heiView

🌍 **Language Shortcut:** [English](#english-version) | [中文版](#chinese-version)

<a name="english-version"></a>
## English Version

### 📖 Introduction

A modern course schedule and room availability viewer for Heidelberg University (heiView). 
heiView is an interactive timetable visualization tool for campus courses and buildings, providing a smarter way to explore your university schedule, room occupancy, and professors across different campuses.

### ✨ Features

- **Modern & Responsive UI**: Built with React, Vite, and Ant Design.
- **Interactive Timetable**: Visualizes daily course schedules and empty slots intuitively.
- **Localization**: Supports English (EN), German (DE), and Simplified Chinese (ZH) out of the box.
- **Advanced Filtering**: Filter heavily populated schedules by Campus, Building, Search terms, or specific Room Features (e.g., Air conditioning).
- **Fast Backend**: Powered by Node.js, Express, and a local SQLite database for lightning-fast queries.

### 🛠️ Tech Stack

- **Frontend**: React, Vite, Ant Design, TypeScript, Dayjs
- **Backend**: Node.js, Express, SQLite
- **Data Scraper**: Python (BeautifulSoup4)

### 🕷️ How to Use the Crawler

The project relies on Python scripts inside the `crawler/` directory to fetch and parse data from the university portal. The raw output is saved as JSON files in the `data/2026SS/` directory.

1. **Prerequisites**: Ensure you have Python 3.10+ installed along with dependencies (e.g., `beautifulsoup4`, `requests`).
2. **Full Batch Crawl**: Execute your main entry script (e.g., `python crawler/2026ss.py`). This will scrape the entire course directory. *Note: this takes a significant amount of time.*
3. **Single Course / Small Test**: If you are adding features or fixing parser bugs, you do not need to scrape everything. You can isolate a small test by temporarily feeding a single URL to the scraper function (e.g., in `scrape_course_details_2026ss.py`). Run the script pointing to only 1-5 test URLs. Once the output JSON looks correct, proceed to the database sync phase.

### 🚀 Running Local Development

You need **Node.js (v18+)** installed to run the backend and frontend.

**1. Install Dependencies**
```bash
npm install
```

**2. Synchronize the Database**
After obtaining the JSON data via the crawler, you must compile it into the SQLite database (). Run this command whenever your crawler data changes:
```bash
npm run db:sync
```
*(This command runs a combination of catalog patching, compiling JSONs to SQLite, and importing building master data).*

**3. Start the Backend API**
```bash
npm run dev:api
```
*The Express server will start at http://localhost:3001.*

**4. Start the Frontend App**
Open a new terminal window and run:
```bash
npm run dev
```
*The Vite frontend will start (usually at http://localhost:5173 or 8080) and automatically proxy API requests to the backend.*

### 📄 License

This project is licensed under the [AGPL-3.0 License](LICENSE).

---
<br>

<a name="chinese-version"></a>
## 中文版

### 📖 项目简介

海德堡大学现代化的课程表与教室空闲状态查看器（heiView）。
heiView 旨在提供一个交互式的时间轴可视化看板，让你能够以最聪明、直观的方式探索大学各校区的课程安排、教室占用情况以及教授信息。

### ✨ 核心功能

- **现代化界面**：基于 React、Vite 和 Ant Design 打造的轻量级响应式 UI。
- **可视化时间轴**：直观展示每日课程的时间跨度以及教室的空闲时段。
- **多语言支持**：原生支持中文（ZH）、英文（EN）和德文（DE）无缝切换。
- **综合筛选**：支持按校区、建筑、关键词（课程名/教授名）以及特定教室配置（例如：是否有空调、无门禁等）进行过滤检索。
- **高性能后端**：采用 Node.js (Express) + SQLite 构建轻量快速的本地数据接口。

### 🛠️ 技术栈

- **前端**：React, Vite, Ant Design, TypeScript, Dayjs
- **后端**：Node.js, Express, SQLite
- **数据爬虫**：Python (BeautifulSoup4)

### 🕷️ 如何使用爬虫工具

项目依赖 `crawler/` 目录下的 Python 脚本从大学官方门户获取并解析课程数据。原始抓取的结果会以 JSON 文件的形式保存在 `data/2026SS/` 目录中。

1. **环境准备**：需要安装 Python 3.10 及以上版本，并安装相应的爬虫库（如 `beautifulsoup4`, `requests` 等）。
2. **全量爬取**：运行你的主入口脚本（如 `python crawler/2026ss.py`）。这会遍历并下载全部课程目录，此过程耗时较长。
3. **单页面/少量测试**：在开发新功能或修复解析 BUG 时，不需要全量拉取。你可以修改脚本中的 URL 列表，或者直接调用解析函数（例如 `scrape_course_details_2026ss.py` 中的逻辑），仅传入 1~5 个目标课程的链接进行小规模测试。当生成的本地 JSON 结构符合预期后，再执行后端的同步步骤即可。

### 🚀 本地运行与开发指南

请确保本地已安装 **Node.js (v18+)**。

**1. 安装依赖**
```bash
npm install
```

**2. 同步与构建数据库**
在爬虫运行完毕并生成 JSON 数据后，你需要将它们编译为 SQLite 数据库（）。每当爬虫数据更新后，请执行：
```bash
npm run db:sync
```
*（此命令会自动按顺序执行：清洗分类目录 -> JSON编译入库 -> 导入建筑静态主数据）。*

**3. 启动后端 API 服务**
```bash
npm run dev:api
```
*Node.js 服务将默认运行在 http://localhost:3001。*

**4. 启动前端应用**
保持后端终端运行，新开一个终端窗口执行：
```bash
npm run dev
```
*前端将通过 Vite 启动（通常为 http://localhost:5173 或 8080），它会自动拦截并向后台 API 代理转发所有的 `/api/*` 请求。*

### 📄 协议

本项目采用 [AGPL-3.0 协议](LICENSE) 开源。

