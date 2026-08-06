import { Database } from "bun:sqlite";
import path from "path";

const isTest = process.env.NODE_ENV === "test";
const DB_PATH = isTest ? path.join(process.cwd(), "test_weblog.db") : path.join(process.cwd(), "weblog.db");
export const db = new Database(DB_PATH, { create: true });

// Enable WAL mode & disk durability
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Initialize Schema
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      author_name TEXT DEFAULT 'Admin Author',
      author_bio TEXT DEFAULT 'Blogger & Tech Enthusiast',
      author_avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
      theme_id TEXT DEFAULT 'contempo',
      custom_css TEXT DEFAULT '',
      settings_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blog_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      status TEXT DEFAULT 'published', -- 'published', 'draft'
      labels TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      author_name TEXT DEFAULT 'Admin Author',
      views INTEGER DEFAULT 0,
      published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blog_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_description TEXT DEFAULT '',
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE
    );
  `);

  try { db.exec("ALTER TABLE pages ADD COLUMN meta_description TEXT DEFAULT '';"); } catch (e) {}
  try { db.exec("ALTER TABLE pages ADD COLUMN status TEXT DEFAULT 'published';"); } catch (e) {}
  try { db.exec("ALTER TABLE pages ADD COLUMN created_at DATETIME;"); } catch (e) {}
  try { db.exec("ALTER TABLE pages ADD COLUMN updated_at DATETIME;"); } catch (e) {}
  try { db.exec("ALTER TABLE posts ADD COLUMN updated_at DATETIME;"); } catch (e) {}

  db.exec(`

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT,
      author_avatar TEXT,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'approved', -- 'approved', 'pending', 'spam'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gadgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blog_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- 'profile', 'archive', 'labels', 'popular_posts', 'html', 'text', 'featured_post', 'search'
      title TEXT NOT NULL,
      section TEXT NOT NULL, -- 'header', 'sidebar', 'footer', 'main'
      position INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      config_json TEXT DEFAULT '{}',
      FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blog_id INTEGER NOT NULL,
      post_id INTEGER,
      referrer TEXT DEFAULT 'Direct',
      browser TEXT DEFAULT 'Chrome',
      device TEXT DEFAULT 'Desktop',
      visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );
  `);

  // Ensure default admin user exists
  const adminUser = db.query("SELECT * FROM users WHERE username = 'admin'").get();
  if (!adminUser) {
    db.prepare("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')").run();
  }

  // Seed default data if database is brand new
  const blogCount = db.query("SELECT COUNT(*) as count FROM blogs").get() as { count: number };
  if (blogCount.count === 0) {
    seedDatabase();
  }
}

export function seedMockData() {
  seedDatabase();
}

export function seedDatabase() {
  // Clear existing & reset autoincrement counters
  db.exec("DELETE FROM analytics; DELETE FROM gadgets; DELETE FROM comments; DELETE FROM pages; DELETE FROM posts; DELETE FROM blogs;");
  try { db.exec("DELETE FROM sqlite_sequence;"); } catch (e) {}

  // Default Blog 1
  const defaultSettings = JSON.stringify({
    posts_per_page: 5,
    comments_enabled: true,
    dark_mode: true,
    header_image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
    accent_color: "#6366f1",
    background_color: "#0f172a",
    font_family: "Inter",
    layout_style: "sidebar-right"
  });

  const insertBlog = db.prepare(`
    INSERT INTO blogs (name, slug, description, author_name, author_bio, author_avatar, theme_id, settings_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res1 = insertBlog.run(
    "TechPulse & Code Journal",
    "techpulse",
    "Exploring high-performance web engineering, Bun runtime secrets, modern UI design, and cloud architecture.",
    "Alex Mercer",
    "Full-stack engineer & open-source contributor. Writing about Bun, JavaScript performance, and sleek user interfaces.",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80",
    "contempo",
    defaultSettings
  );
  const blogId = Number(res1.lastInsertRowid);

  // Blog 2 - Secondary blog for multi-blog testing
  const res2 = insertBlog.run(
    "Nomad Wanderlust",
    "wanderlust",
    "Stories, photography, and guides from remote working around the globe.",
    "Alex Mercer",
    "Digital nomad traveling to 40+ countries while writing clean code.",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=250&q=80",
    "soho",
    JSON.stringify({
      posts_per_page: 6,
      comments_enabled: true,
      dark_mode: false,
      header_image: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=80",
      accent_color: "#059669",
      background_color: "#f8fafc",
      font_family: "Plus Jakarta Sans",
      layout_style: "sidebar-right"
    })
  );

  // Insert Posts for TechPulse
  const insertPost = db.prepare(`
    INSERT INTO posts (blog_id, title, slug, content, excerpt, status, labels, cover_image, author_name, views, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const p1 = insertPost.run(
    blogId,
    "Why Bun 1.3 is Revolutionizing Serverless & Full-Stack JS",
    "why-bun-13-is-revolutionizing-serverless",
    `<h2>The Era of Ultra-Fast JavaScript Tooling</h2>
<p>JavaScript runtimes have evolved dramatically over the last decade. Node.js laid the foundation, Deno introduced secure defaults, and <strong>Bun</strong> pushed the boundaries of native performance to an entirely new tier.</p>

<h3>Key Performance Highlights</h3>
<ul>
  <li><strong>Instant Startup:</strong> Cold starts under 10 milliseconds.</li>
  <li><strong>Built-in SQLite:</strong> Extremely fast zero-dependency local database handling via <code>bun:sqlite</code>.</li>
  <li><strong>Native Bundling:</strong> Serve HTML, JSX, CSS directly without requiring heavy Webpack setup.</li>
</ul>

<blockquote class="my-4 border-l-4 border-indigo-500 pl-4 italic text-slate-300 bg-slate-800/50 p-3 rounded">
"Bun isn't just a runtime; it's a unified developer toolkit designed for maximum speed and simplicity."
</blockquote>

<p>Building applications with <code>Bun.serve()</code> brings high-throughput HTTP serving with WebSocket integration right out of the box.</p>`,
    "Explore how Bun 1.3 speeds up backend APIs, native SQLite queries, and full-stack bundling with zero setup hassle.",
    "published",
    "Bun, JavaScript, Backend, WebDev",
    "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=900&q=80",
    "Alex Mercer",
    1240,
    "2026-08-01 10:00:00"
  );
  const p1Id = Number(p1.lastInsertRowid);

  const p2 = insertPost.run(
    blogId,
    "Building modern Blogger-style CMS with HTML5 & Pure CSS",
    "building-modern-blogger-cms",
    `<h2>Reviving the Blogger & Blogspot Aesthetics for the Modern Web</h2>
<p>Remember custom XML templates, gadget layouts, and instant post previewing on Blogspot? We are recreating that iconic simplicity coupled with modern visual polish like glassmorphism and real-time theme customizers.</p>

<h3>What Makes a Great Blogger CMS?</h3>
<ol>
  <li><strong>Drag and drop widget layout management</strong> (Header, Sidebar, Main Feed, Footer).</li>
  <li><strong>Instant Theme Tweaking:</strong> Adjust fonts, accent hues, and layout widths live.</li>
  <li><strong>Rich Comments Moderation:</strong> Filter spam and reply to readers easily.</li>
  <li><strong>Built-in Analytics:</strong> Track daily impressions and top referral sources.</li>
</ol>
<p>With lightweight tools, your blog loads in under 100ms globally while looking like a million bucks!</p>`,
    "How to recreate the flexibility of classic Blogspot gadget layouts with modern CSS and real-time live previewing.",
    "published",
    "Blogger, CMS, WebDev, Design",
    "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=900&q=80",
    "Alex Mercer",
    890,
    "2026-08-03 14:30:00"
  );
  const p2Id = Number(p2.lastInsertRowid);

  const p3 = insertPost.run(
    blogId,
    "Mastering CSS Glassmorphism & Micro-Animations in 2026",
    "mastering-css-glassmorphism-micro-animations",
    `<h2>Elevating Visual Interfaces</h2>
<p>Modern visual design requires depth, subtle lighting, and tactile user feedback. Glassmorphism combines semi-transparent backgrounds with backdrop blur filters to give UI elements an elegant floating glass feel.</p>

<pre><code class="language-css">.glass-card {
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
}</code></pre>
<p>Combine this with micro-transitions on hover states to give your blog readers a premium reading experience.</p>`,
    "A hands-on guide to backdrop-filter techniques, dark mode color science, and fluid CSS animations.",
    "published",
    "CSS, Design, Frontend, UI/UX",
    "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=900&q=80",
    "Alex Mercer",
    512,
    "2026-08-05 09:15:00"
  );
  const p3Id = Number(p3.lastInsertRowid);

  // Draft post
  insertPost.run(
    blogId,
    "[Draft] Upcoming SQLite Optimization Techniques in Bun",
    "sqlite-optimization-techniques-bun",
    `<h2>Drafting post on WAL mode and prepared query caching</h2><p>This draft post is currently hidden from the public blog feed until published.</p>`,
    "Sneak peek at upcoming benchmarks and WAL mode tuning tricks for SQLite.",
    "draft",
    "SQLite, Database, Performance",
    "https://images.unsplash.com/photo-1544383835-bda2bc66a55d?auto=format&fit=crop&w=900&q=80",
    "Alex Mercer",
    0,
    "2026-08-06 08:00:00"
  );

  // Insert Pages
  const insertPage = db.prepare(`
    INSERT INTO pages (blog_id, title, slug, content, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertPage.run(
    blogId,
    "About the Author",
    "about",
    `<h2>Hello & Welcome!</h2>
<p>My name is Alex Mercer. I am a passionate full-stack software engineer and writer who loves sharing tech tutorials, performance deep-dives, and sleek UI implementations.</p>
<p>Feel free to subscribe to our RSS feed or connect via social channels!</p>`,
    "published"
  );

  insertPage.run(
    blogId,
    "Contact & Press",
    "contact",
    `<h2>Get in Touch</h2>
<p>Have questions, sponsorships, or article suggestions? Send an email to <code>alex@techpulse.example.com</code> or reach out on Twitter/X @techpulse.</p>`,
    "published"
  );

  // Insert Comments
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, author_name, author_email, author_avatar, content, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertComment.run(
    p1Id,
    "Sarah Connor",
    "sarah@example.com",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
    "Awesome article! Switching to Bun for our backend microservices cut our cold start times down by 80%. Great breakdown on SQLite integration too!",
    "approved",
    "2026-08-01 12:15:00"
  );

  insertComment.run(
    p1Id,
    "David Chen",
    "david@tech.io",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80",
    "Is `bun:sqlite` fully compatible with WAL mode across multi-process clusters?",
    "approved",
    "2026-08-02 09:40:00"
  );

  insertComment.run(
    p2Id,
    "Elena Rostova",
    "elena@design.net",
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80",
    "The layout gadget customizer feels so nostalgic yet snappy! Love the clean theme options.",
    "approved",
    "2026-08-04 18:20:00"
  );

  insertComment.run(
    p2Id,
    "CryptoBot99",
    "bot@spam.com",
    "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
    "Click here for free bitcoin giveaway 🚀🚀🚀 http://spam-link.test",
    "spam",
    "2026-08-05 02:11:00"
  );

  // Insert Gadgets (Blogger Layout Widgets)
  const insertGadget = db.prepare(`
    INSERT INTO gadgets (blog_id, type, title, section, position, is_enabled, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertGadget.run(
    blogId,
    "profile",
    "About Me",
    "sidebar",
    1,
    1,
    JSON.stringify({ show_avatar: true, show_bio: true })
  );

  insertGadget.run(
    blogId,
    "search",
    "Search Blog",
    "sidebar",
    2,
    1,
    JSON.stringify({ placeholder: "Search articles..." })
  );

  insertGadget.run(
    blogId,
    "popular_posts",
    "Popular Posts",
    "sidebar",
    3,
    1,
    JSON.stringify({ limit: 4, show_snippets: true })
  );

  insertGadget.run(
    blogId,
    "labels",
    "Categories & Tags",
    "sidebar",
    4,
    1,
    JSON.stringify({ display_style: "cloud", show_count: true })
  );

  insertGadget.run(
    blogId,
    "archive",
    "Blog Archive",
    "sidebar",
    5,
    1,
    JSON.stringify({ style: "flat" })
  );

  insertGadget.run(
    blogId,
    "html",
    "Newsletter Signup",
    "sidebar",
    6,
    1,
    JSON.stringify({ content: `<div class="p-4 bg-indigo-900/30 rounded-xl border border-indigo-500/20 text-center"><h4 class="font-bold text-indigo-300 mb-1">📬 Subscribe</h4><p class="text-xs text-slate-400 mb-3">Get weekly Bun & WebDev tips directly in your inbox.</p><input type="email" placeholder="Your email..." class="w-full text-xs p-2 rounded bg-slate-900 border border-slate-700 text-slate-200 mb-2 focus:outline-none focus:border-indigo-500"><button class="w-full text-xs py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition">Join Newsletter</button></div>` })
  );

  insertGadget.run(
    blogId,
    "text",
    "Copyright & Info",
    "footer",
    1,
    1,
    JSON.stringify({ content: "© 2026 TechPulse Weblogger CMS. Powered by Bun Runtime & SQLite." })
  );

  // Insert Analytics data
  const insertAnalytics = db.prepare(`
    INSERT INTO analytics (blog_id, post_id, referrer, browser, device, visited_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const referrers = ["Google Search", "Twitter / X", "GitHub", "Direct", "Reddit r/webdev", "Hacker News"];
  const browsers = ["Chrome", "Firefox", "Safari", "Edge", "Brave"];
  const devices = ["Desktop", "Mobile", "Tablet"];

  const now = new Date();
  for (let i = 0; i < 60; i++) {
    const pastDate = new Date(now.getTime() - (Math.random() * 14 * 86400 * 1000));
    const ref = referrers[Math.floor(Math.random() * referrers.length)] || "Direct";
    const br = browsers[Math.floor(Math.random() * browsers.length)] || "Chrome";
    const dev = devices[Math.floor(Math.random() * devices.length)] || "Desktop";
    const pid = Math.random() > 0.3 ? p1Id : (Math.random() > 0.5 ? p2Id : p3Id);

    insertAnalytics.run(
      blogId,
      pid,
      ref,
      br,
      dev,
      pastDate.toISOString().replace("T", " ").substring(0, 19)
    );
  }
}

// Call init on module load
initDB();

export function authenticateUser(username: string, pass: string): boolean {
  const user = db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!user) return false;
  return user.password === pass;
}

export function createSession(username: string): string {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19);
  db.prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)").run(token, username, expiresAt);
  return token;
}

export function validateSession(token: string | null): { username: string } | null {
  if (!token) return null;
  const session = db.query("SELECT * FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP").get(token) as any;
  if (!session) return null;
  return { username: session.username };
}

export function destroySession(token: string | null) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function updateUserCredentials(currentUsername: string, currentPass: string, newUsername: string, newPass: string): { success: boolean; error?: string } {
  const user = db.query("SELECT * FROM users WHERE username = ?").get(currentUsername) as any;
  if (!user) return { success: false, error: "User not found" };
  if (user.password !== currentPass) return { success: false, error: "Current password is incorrect" };

  try {
    db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(newUsername, newPass, user.id);
    db.prepare("UPDATE sessions SET username = ? WHERE username = ?").run(newUsername, currentUsername);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: "Username already taken or database error" };
  }
}
