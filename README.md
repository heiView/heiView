<div align="center">
  <a href="https://heiview.de/" target="_blank" rel="noopener noreferrer">
    <img src="public/heiView_logo.png" alt="heiView Logo" height="80" />
  </a>
  </br>
  </br>
  <a href="https://heiview.de/" target="_blank" rel="noopener noreferrer"> https://heiview.de </a>
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
- **Add to Calendar**: Export any course to Google Calendar or download a standard `.ics` file compatible with Apple Calendar and Outlook. Recurring weekly courses are automatically set up with the correct end date.
- **Building independent bookmarks**: Each building has its own exclusive URL. It is recommended to switch to a frequently visited building before saving the bookmark.
- **Smart filter search**: Supports filter search by courses, buildings, professor names, etc. in any building.

### Building Catalog

The `data/building-catalog.json` file is a data dictionary generated from the classroom information in the heiCO course, supplemented by a large number of manual modifications. It is used to record the affiliation and alias relationships of different campuses, buildings and classrooms. For example, Grabengasse 3-5 is displayed as Neue Universität for easy understanding, and Voßstraße 2 is divided into 10 different buildings to avoid new students getting lost, etc.

There are still some contents to be improved, such as incomplete building floors, adding common abbreviations to the buildings and information about the facilities inside the classroom (whether there are sockets and air conditioners, etc.).

### To Do List

Due to incomplete and inconsistently formatted data in heiCO, over 700 out of the 4,000+ courses in the 2026 Summer Semester lack directly downloadable schedule and location information. These courses are currently placed under "Other → No Information" and some courses with incomplete information are placed in "Other"， require manual addition.

**We warmly welcome contributions!** You can:

- Join the project as a long-term editor to help complete course data, my student email id is ht305.
- Create Issues to report missing or incorrect information
- Submit Pull Requests to update the file directly

### Local Testing & Development

**1. Install Dependencies**
```bash
npm install
```

**2. Crawl Course Data**

Run the crawler to fetch all courses for the semester (requires campus network or university VPN):
```bash
python crawler/heico_crawler.py
```
Repeated runs only write files when content changes. To update a single course, use `--course-url "<URL>"`.

**3. Synchronize & Build Database**

After the crawler generates new JSON files, run:
```bash
npm run db:sync
```
Your newly scraped data will automatically sync to the backend database.

**4. Configure Environment Variables**

Create a `.env` file in the project root before starting the backend:
```bash
# .env
ADMIN_USER=admin          # superadmin username (default: admin)
ADMIN_PASS=changeme       # superadmin password (default: changeme)
ADMIN_SECRET=dev-secret   # JWT signing secret — change this in production
PORT=3001                 # API server port (default: 3001)
```

If `.env` is absent, the server falls back to the defaults shown above, which is fine for local development.

**5. Start the Backend API Server**
```bash
npm run dev:api
```

**6. Start the Frontend App**

Keep the backend running. In a new terminal window:
```bash
npm run dev
```

**7. Access the Admin Page**

Open `http://localhost:5173/admin` in your browser and log in with the superadmin credentials set in `.env` (defaults: `admin` / `changeme`).

The admin page allows you to:
- Edit course room and building assignments for individual occurrences
- Hide courses from the public schedule
- Manage the building catalog (add, edit, merge, or delete buildings and rooms)
- Create additional editor accounts
- View the audit log of all changes made by editor accounts

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
- **加入个人日历**：可将任意课程导出到 Google 日历，或下载兼容苹果日历、Outlook 的标准 `.ics` 文件。每周重复的课程会自动设置正确的结束日期。
- **建筑独立书签**：每栋建筑都有自己的专属网址，建议切换到常去的建筑后再保存书签。
- **快速过滤检索**：支持在任意界面按课程、建筑、教授名等进行过滤检索。


### 校园建筑数据库

`data/building-catalog.json` 文件是由heiCO课程里的教室信息生成的数据字典，辅以大量手动修改，用于记录不同校区、建筑物和教室的从属与别名关系，例如让 Grabengasse 3-5 显示为 Neue Universität 方便理解，将 Voßstraße 2 细分为10栋不同建筑避免新生迷路等。

目前还有部分内容待完善，如建筑楼层不全，为建筑添加常见的简称及教室内部的设施信息（是否有插座和空调等）。

### 待办事项

由于heiCO上的课程信息存在大量缺失和格式不规范等问题，2026夏季学期的4000+门课程里有超过700门没有可以直接下载的时间和地点信息，目前被放置在Other -> No Information中，还有部分信息不全的课程被放在Other里，都需要后续手动添加，欢迎感兴趣的同学邮件我(ht305)加入本项目一同编辑，也欢迎创建Issue提出反馈/建议或直接修改文件提交Pull Request。

### 本地测试与开发

**1. 安装依赖**
```bash
npm install
```

**2. 爬取课程数据**

运行爬虫获取本学期所有课程数据（需要在校园网或大学 VPN 环境下进行）：
```bash
python crawler/heico_crawler.py
```
重复运行时仅在内容发生变化时才写入文件（增量更新）。如需更新单门课程，可使用 `--course-url "<课程网址>"`。

**3. 同步与构建数据库**

在爬虫运行完毕并生成新的 JSON 文件后，请执行：

```bash
npm run db:sync
```

新爬取的内容将自动同步至后端数据库。

**4. 配置环境变量**

在项目根目录创建 `.env` 文件，然后再启动后端：
```bash
# .env
ADMIN_USER=admin          # 超级管理员用户名（默认值：admin）
ADMIN_PASS=changeme       # 超级管理员密码（默认值：changeme）
ADMIN_SECRET=dev-secret   # JWT 签名密钥，生产环境请务必修改
PORT=3001                 # API 服务端口（默认值：3001）
```

若 `.env` 文件不存在，服务端会使用上述默认值，本地开发时无需额外配置。

**5. 启动后端 API 服务**
```bash
npm run dev:api
```

**6. 启动前端应用**

保持后端终端运行，新开一个终端窗口执行：
```bash
npm run dev
```

**7. 访问管理页面**

在浏览器中打开 `http://localhost:5173/admin`，使用 `.env` 中设置的超级管理员账号登录（默认：`admin` / `changeme`）。

管理页面支持以下操作：
- 编辑单个课程条目的教室与建筑信息
- 将课程从公开课表中隐藏
- 管理建筑数据库（新增、编辑、合并或删除建筑与教室）
- 创建普通编辑员账号
- 查看所有编辑员账号的操作审计日志

### 协议

本项目采用 [AGPL-3.0 协议](LICENSE) 开源。
