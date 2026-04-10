<div align="center">
  <img src="public/heiView_logo.png" alt="heiView Logo" height="80" />
</div>

</br>

<div align="center">

[English](#english-version) | [中文版](#chinese-version)

</div>

<a id="english-version"></a>
### Introduction

Tired of cryptic building addresses in heiCO? Exhausted by needing to connect VPN just to check a classroom? Uncertain whether your preferred study room will be occupied when you need it?

These seemingly small inconveniences affect the daily experience of Heidelberg University students. That's why heiView was created.

By restructuring campus building and classroom data across all campuses and combining it with an intuitive timeline view, you can now quickly check any classroom's course schedule and occupancy status.

Whether you're looking for a quiet room to study, or exploring courses and activities of interest, heiView empowers you to stay informed about campus-wide schedules anytime, anywhere.

### Core Features

- **Interactive Timeline Visualization**: Intuitively displays daily course schedules and idle time slots across all classrooms in campus buildings.
- **Detailed Course Information**: Click on any course card in the timeline to view full details, including direct heiCO links.
- **Smart Filtering & Search**: Filter and search by campus, building, or keywords (course names, professor names).

### Building Catalog

The `data/building-catalog.json` file is a data dictionary generated from the classroom information in the heiCO course, supplemented by a large number of manual modifications. It is used to record the affiliation and alias relationships of different campuses, buildings and classrooms. For example, Grabengasse 3-5 is displayed as Neue Universität for easy understanding, and Voßstraße 2 is divided into 10 different buildings to avoid new students getting lost, etc.

There are still some contents to be improved, such as incomplete building floors, adding common abbreviations to the buildings and information about the facilities inside the classroom (whether there are sockets and air conditioners, etc.).


### To Do List

Due to incomplete and inconsistently formatted data in heiCO, over 700 out of the 4,000+ courses in the 2026 Summer Semester lack directly downloadable schedule and location information. These courses are currently placed under **"Other" → "No Information"** and require manual addition.

**We warmly welcome contributions!** You can:

- Join the project as a long-term editor to help complete course data, my student email id is ht305.
- Create Issues to report missing or incorrect information
- Submit Pull Requests to update the file directly

### heiCO Crawler

The project relies on Python scripts in the `crawler/` directory to download course data from heiCO. Raw scraped results are saved as JSON files in the `data/2026SS/` directory.

1. **Full Batch Crawl**: Run `python 2026ss.py` to traverse and download all ~4,000 courses for the 2026 Summer Semester. This requires campus network or university VPN access and takes considerable time.
2. **Small Test Crawl**: When developing features or fixing parsing bugs, use this to grab a limited number of courses for quick testing:
   ```python
   python 2026ss.py --limit-courses 10
   ```
3. **Single Course Crawl**: Test precise parsing against a single course URL:
   ```python
   python 2026ss.py --course-url "<heiCO course URL>"
   ```
4. **Incremental Updates**: Repeated runs only write files when course web page content changes, avoiding unnecessary disk I/O. Room details are fetched only when room information changes, reducing load on heiCO.

### Local Testing & Development

**1. Install Dependencies**
```bash
npm install
```

**2. Synchronize & Build Database**
After the crawler generates new JSON files, run:
```bash
npm run db:sync
```
Your newly scraped data will automatically sync to the backend database.

**3. Start the Backend API Server**
```bash
npm run dev:api
```

**4. Start the Frontend App**
Keep the backend running. In a new terminal window:
```bash
npm run dev
```

### License

This project is licensed under the [AGPL-3.0 License](LICENSE).

---

<a id="chinese-version"></a>
### 简介

受够了heiCO里谜一样的建筑地址吗？
很烦查个教室还要先点开OTP连VPN吗？
想上自习却不确定等会是否有人上课吗？

这些看似细小的问题，却每天都在影响着海德堡大学学生们的体验。而heiView正是为此而生。

通过重新整理各校区的建筑与教室数据，并结合直观的时间轴视图，你现在可以快速查看任意教室的课程安排与占用情况。

无论你是想找一间空教室自习，还是寻找感兴趣的课程与活动，heiView都能帮你随时随地掌握全校的课程动向。

### 核心功能

- **可视化时间轴**：直观展示每日课程的时间跨度以及各建筑所有楼层教室的空闲时段。
- **课程详细信息**：点击时间轴上的课程卡片即可查看详细信息，包含课程的heiCO链接。
- **关键词搜索**：支持按校区、建筑、关键词（课程名/教授名）进行过滤检索。

### 校园建筑数据库

`data/building-catalog.json` 文件是由heiCO课程里的教室信息生成的数据字典，辅以大量手动修改，用于记录不同校区、建筑物和教室的从属与别名关系，例如让 Grabengasse 3-5 显示为 Neue Universität 方便理解，将 Voßstraße 2 细分为10栋不同建筑避免新生迷路等。

目前还有部分内容待完善，如建筑楼层不全，为建筑添加常见的简称及教室内部的设施信息（是否有插座和空调等）。

### 待办事项

由于heiCO上的课程信息存在大量缺失和格式不规范等问题，2026夏季学期的4000+门课程里有超过700门没有可以直接下载的时间和地点信息，目前被放置在Other -> No Information中，需要后续手动添加，欢迎感兴趣的同学邮件我的学号ht305加入本项目一同编辑，也欢迎创建Issue提出反馈/建议或直接修改文件提交Pull Request。

### 爬虫工具

项目依赖 `crawler/` 目录下的 Python 脚本从heiCO下载课程数据。原始抓取的结果会以 JSON 文件的形式保存在 `data/2026SS/` 目录中。

1. **全量爬取**：运行脚本 2026ss.py，程序将会遍历并下载全部2026年夏季学期课程，约4000条，此过程需要在校园网或大学VPN下进行。
1. **少量测试**：在开发新功能或修复解析 BUG 时，可以使用以下命令爬取若干条课程信息进行小规模测试。

	```python
	python 2026ss.py --limit-courses 10
	```

1. **单页爬取**：可使用以下命令爬取单一课程进行精准测试。

	```python
	python 2026ss.py --course-url "<heiCO课程网址>"
	```

1. **增量爬取**：重复运行时，只在发现课程网页内容变化时才写入文件，避免无意义的写盘。检测到教室信息发生变化时才进一步爬取教室详情页，减少heiCO访问压力。

### 本地测试与开发

**1. 安装依赖**
```bash
npm install
```

**2. 同步与构建数据库**
在爬虫运行完毕并生成新的 JSON 文件后，请执行：

```bash
npm run db:sync
```

新爬取的内容将自动同步至后端数据库。

**3. 启动后端 API 服务**
```bash
npm run dev:api
```

**4. 启动前端应用**
保持后端终端运行，新开一个终端窗口执行：
```bash
npm run dev
```


### 协议

本项目采用 [AGPL-3.0 协议](LICENSE) 开源。

