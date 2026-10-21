# WeblogCMS

[![Bun](https://img.shields.io/badge/Bun-v1.0%2B-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/SQLite-bun%3Asqlite-003B57?logo=sqlite)](https://bun.sh/docs/api/sqlite)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A modern, fast, full-featured Weblog Content Management System (CMS) built entirely on **Bun** and **SQLite** (`bun:sqlite`).

`weblogcms` provides a complete blog publishing platform featuring multi-blog support, rich post & page lifecycle management, comment moderation, customizable gadget layout widgets, built-in analytics, RSS feeds, backup export/import, and flatfile JSON synchronization.

---

## 🚀 Key Features

- ⚡ **Native Bun Performance**: Built directly on [`Bun.serve()`](index.ts#L43) and native [`bun:sqlite`](db.ts) for sub-millisecond response times.
- 📰 **Multi-Blog & Custom Slugs**: Create and manage multiple blogs with distinct slugs, descriptions, themes, and settings.
- ✍️ **Content Lifecycle Management**:
  - **Posts**: Rich post management supporting states (`published`, `draft`, `scheduled`, `trash`), tags/labels, meta descriptions, and page-view tracking.
  - **Pages**: Static pages with custom URL slugs and SEO meta descriptions.
- 💬 **Comment Moderation Workflow**: Automated and manual comment moderation statuses (`approved`, `pending`, `spam`, `trash`).
- 🧩 **Dynamic Gadgets & Layout Manager**: Modular layout system with customizable widgets (HTML, Text, Header, Pages, Archive, Labels, Profile, Stats, Search) and position ordering.
- 📊 **Built-in Analytics**: Lightweight visitor analytics tracking referral URLs, user agents, IP addresses, and view counts.
- 📡 **RSS & Atom Feed Generator**: Built-in RSS feeds (`/feed.xml`, `/rss`, `/:slug/feed.xml`) for post distribution.
- 💾 **Dual Storage Architecture**: Primary SQLite database storage (`weblog.db`) with support for flatfile JSON file syncing ([`flatfile.ts`](flatfile.ts)).
- 🔐 **Authentication & Sessions**: Secure admin authentication using hashed credentials, session tokens, and cookie/header authorization ([`db.ts`](db.ts)).
- 📦 **Backup Export & Import**: Complete system backup export and restoration via JSON data transfer.
- 📱 **Single-Page Application & PWA Ready**: Interactive frontend app in [`public/app.js`](public/app.js) with service worker support ([`public/sw.js`](public/sw.js)).
- 📱 **Responsive, Mobile-First UI**: Adaptive layouts, mobile drawer navigation, touch-friendly controls, and fluid typography that fit phones, tablets, and large screens.
- ♿ **Accessibility**: Keyboard focus outlines, reduced-motion support, and semantic HTML structure.

---

## 📁 Project Structure

```
.
├── index.ts                 # HTTP server, routing, API endpoints & static serving
├── db.ts                    # SQLite database schema, initialization & query helpers
├── flatfile.ts              # Flatfile JSON storage reader, writer & sync utilities
├── index.test.ts            # Complete test suite for CMS database & HTTP APIs
├── public/                  # Frontend single-page application assets
│   ├── app.js               # Admin dashboard and blog frontend application logic
│   ├── index.html           # SPA entrypoint HTML layout
│   ├── styles.css           # Modern CSS styling framework
│   └── sw.js                # Service worker for offline & PWA caching
├── package.json             # Bun project metadata and script commands
├── tsconfig.json            # TypeScript configuration
└── CLAUDE.md                # Development guidelines and Bun API usage notes
```

---

## 🛠️ Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0.0 or higher)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Sparky4567/weblogcms.git
   cd weblogcms
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

### Running the Application

- **Development Mode** (with Hot Reloading):
  ```bash
  bun run dev
  ```
  *Or directly:* `bun --hot index.ts`

- **Production Mode**:
  ```bash
  bun start
  ```

The server runs at `http://localhost:3000` by default. You can change the port using the `PORT` environment variable:
```bash
PORT=8080 bun start
```

### 🔑 Default Admin Credentials

When the application runs for the first time, a default administrator account is automatically created:

- **Username**: `admin`
- **Password**: `admin123`

> 💡 **Tip**: You can change your admin username and password at any time via the admin dashboard settings or using the `PUT /api/auth/credentials` API endpoint.


---

## 🧪 Testing

Run the automated test suite using Bun's native test runner:

```bash
bun test
```

The test suite covers:
- Database initialization and seed data verification
- Multi-blog querying and post filtering
- Post, page, comment, and gadget CRUD workflows
- Comment moderation logic
- Admin login, session validation, and credential management
- Backup export and import functionality
- Flatfile storage saving and synchronization

---

## 📡 API Overview

### 🔐 Authentication (`/api/auth`)
- `POST /api/auth/login` - Authenticate admin credentials and generate session token
- `POST /api/auth/logout` - Invalidate active session token
- `GET /api/auth/check` - Validate session status
- `PUT /api/auth/credentials` - Update admin username/password

### 📰 Blogs (`/api/blogs`)
- `GET /api/blogs` - List all weblogs
- `POST /api/blogs` - Create a new weblog
- `GET /api/blogs/:id` - Fetch single blog details
- `PUT /api/blogs/:id` - Update weblog details and settings
- `DELETE /api/blogs/:id` - Delete weblog and related posts

### ✍️ Posts (`/api/posts`)
- `GET /api/posts?blog_id=:id&status=:status` - List posts with optional filters
- `POST /api/posts` - Create post
- `GET /api/posts/:id` - Get post by ID
- `PUT /api/posts/:id` - Update post title, content, status, tags, etc.
- `DELETE /api/posts/:id` - Delete post

### 📄 Pages (`/api/pages`)
- `GET /api/pages?blog_id=:id` - List static pages
- `POST /api/pages` - Create a static page
- `GET /api/pages/:id` - Get page by ID
- `PUT /api/pages/:id` - Update static page
- `DELETE /api/pages/:id` - Delete static page

### 💬 Comments (`/api/comments`)
- `GET /api/comments?post_id=:id&status=:status` - List comments
- `POST /api/comments` - Submit new comment
- `PUT /api/comments/:id` - Moderate comment (approve, spam, trash)
- `DELETE /api/comments/:id` - Delete comment

### 🧩 Gadgets (`/api/gadgets`)
- `GET /api/gadgets?blog_id=:id` - List gadgets for a blog
- `POST /api/gadgets` - Add new gadget widget
- `PUT /api/gadgets/reorder` - Update widget ordering positions
- `PUT /api/gadgets/:id` - Update gadget configuration
- `DELETE /api/gadgets/:id` - Delete gadget

### 📊 Analytics & Utilities
- `POST /api/track` - Log page view event
- `GET /api/stats?blog_id=:id` - Retrieve blog analytics
- `GET /api/export` - Export full database to JSON
- `POST /api/import` - Import database from JSON backup
- `GET /api/flatfile/settings` - Read flatfile settings
- `POST /api/flatfile/sync` - Synchronize database blogs to JSON flatfile
- `GET /feed.xml` / `GET /rss` - Dynamic RSS feed generation

---

## 📜 License

This project is open-source and licensed under the [MIT License](LICENSE).

