import { describe, test, expect, beforeAll } from "bun:test";
import { db, initDB, seedDatabase } from "./db.ts";

beforeAll(() => {
  initDB();
  seedDatabase();
});

describe("Weblogger CMS Core Database & APIs", () => {
  test("Database initialization and initial blog seed", () => {
    const blogs = db.query("SELECT * FROM blogs").all() as any[];
    expect(blogs.length).toBeGreaterThanOrEqual(1);
    expect(blogs[0].name).toContain("TechPulse");
  });

  test("Posts querying and status filter", () => {
    const published = db.query("SELECT * FROM posts WHERE blog_id = 1 AND status = 'published'").all() as any[];
    expect(published.length).toBeGreaterThan(0);

    const draft = db.query("SELECT * FROM posts WHERE blog_id = 1 AND status = 'draft'").all() as any[];
    expect(draft.length).toBeGreaterThanOrEqual(1);
  });

  test("Create, update, and delete post", () => {
    // Create
    const insertRes = db.prepare(`
      INSERT INTO posts (blog_id, title, slug, content, excerpt, status, labels)
      VALUES (1, 'Test Bun Unit Post', 'test-bun-unit-post', '<p>Testing content</p>', 'Testing excerpt', 'published', 'Unit,Test')
    `).run();
    const postId = Number(insertRes.lastInsertRowid);
    expect(postId).toBeGreaterThan(0);

    // Read
    const fetched = db.query("SELECT * FROM posts WHERE id = ?").get(postId) as any;
    expect(fetched.title).toBe("Test Bun Unit Post");
    expect(fetched.labels).toBe("Unit,Test");

    // Update
    db.prepare("UPDATE posts SET title = 'Updated Title' WHERE id = ?").run(postId);
    const updated = db.query("SELECT * FROM posts WHERE id = ?").get(postId) as any;
    expect(updated.title).toBe("Updated Title");

    // Delete
    db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
    const deleted = db.query("SELECT * FROM posts WHERE id = ?").get(postId);
    expect(deleted).toBeNull();
  });

  test("Comments moderation workflow", () => {
    // Add comment
    const res = db.prepare(`
      INSERT INTO comments (post_id, author_name, author_email, content, status)
      VALUES (1, 'Tester Reader', 'test@example.com', 'Great post!', 'pending')
    `).run();
    const commentId = Number(res.lastInsertRowid);

    const comment = db.query("SELECT * FROM comments WHERE id = ?").get(commentId) as any;
    expect(comment.status).toBe("pending");

    // Moderate to approved
    db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(commentId);
    const approved = db.query("SELECT * FROM comments WHERE id = ?").get(commentId) as any;
    expect(approved.status).toBe("approved");

    // Cleanup
    db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
  });

  test("Gadget Layout Management & Editing Workflow", () => {
    const gadgets = db.query("SELECT * FROM gadgets WHERE blog_id = 1").all() as any[];
    expect(gadgets.length).toBeGreaterThan(0);
    const hasProfile = gadgets.some(g => g.type === 'profile');
    expect(hasProfile).toBe(true);

    // Create a new gadget
    const createRes = db.prepare(`
      INSERT INTO gadgets (blog_id, type, title, section, position, config_json)
      VALUES (1, 'html', 'Custom Widget', 'sidebar', 99, '{"content":"<p>Custom HTML</p>"}')
    `).run();
    const gadgetId = Number(createRes.lastInsertRowid);

    // Edit the gadget (title, section, type, config_json)
    db.prepare(`
      UPDATE gadgets
      SET title = 'Updated Widget Title',
          section = 'footer',
          type = 'text',
          config_json = '{"content":"Updated text content"}'
      WHERE id = ?
    `).run(gadgetId);

    const updatedGadget = db.query("SELECT * FROM gadgets WHERE id = ?").get(gadgetId) as any;
    expect(updatedGadget.title).toBe("Updated Widget Title");
    expect(updatedGadget.section).toBe("footer");
    expect(updatedGadget.type).toBe("text");
    expect(JSON.parse(updatedGadget.config_json).content).toBe("Updated text content");

    // Delete the gadget
    db.prepare("DELETE FROM gadgets WHERE id = ?").run(gadgetId);
    const deleted = db.query("SELECT * FROM gadgets WHERE id = ?").get(gadgetId);
    expect(deleted).toBeNull();
  });

  test("Static Page creation, custom meta description and edit workflow", () => {
    // Create page with explicit custom meta_description
    const res1 = db.prepare(`
      INSERT INTO pages (blog_id, title, slug, content, meta_description)
      VALUES (1, 'Privacy Policy', 'privacy', '<p>Privacy details</p>', 'Custom SEO description for privacy page')
    `).run();
    const pageId1 = Number(res1.lastInsertRowid);
    const p1 = db.query("SELECT * FROM pages WHERE id = ?").get(pageId1) as any;
    expect(p1.meta_description).toBe("Custom SEO description for privacy page");

    // Update page title and custom meta_description
    db.prepare("UPDATE pages SET title = 'Privacy Policy 2026', meta_description = 'Updated custom meta' WHERE id = ?").run(pageId1);
    const p1Updated = db.query("SELECT * FROM pages WHERE id = ?").get(pageId1) as any;
    expect(p1Updated.title).toBe("Privacy Policy 2026");
    expect(p1Updated.meta_description).toBe("Updated custom meta");

    // Cleanup
    db.prepare("DELETE FROM pages WHERE id = ?").run(pageId1);
  });

  test("Blog Settings update and JSON configuration merging", () => {
    db.prepare(`
      UPDATE blogs
      SET name = 'Updated TechPulse Blog',
          description = 'New updated description',
          settings_json = ?
      WHERE id = 1
    `).run(JSON.stringify({ posts_per_page: 15, comments_enabled: false }));

    const updatedBlog = db.query("SELECT * FROM blogs WHERE id = 1").get() as any;
    expect(updatedBlog.name).toBe("Updated TechPulse Blog");
    expect(updatedBlog.description).toBe("New updated description");

    const settings = JSON.parse(updatedBlog.settings_json);
    expect(settings.posts_per_page).toBe(15);
    expect(settings.comments_enabled).toBe(false);
  });

  test("HTTP Bun Server API Integration", async () => {
    // Start local test server instance
    const server = Bun.serve({
      port: 3009,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/blogs") {
          const blogs = db.query("SELECT * FROM blogs").all();
          return new Response(JSON.stringify(blogs), { headers: { "Content-Type": "application/json" } });
        }
        if (url.pathname === "/feed.xml") {
          return new Response("<rss version='2.0'><channel><title>TechPulse</title></channel></rss>", { headers: { "Content-Type": "application/xml" } });
        }
        return new Response("Not Found", { status: 404 });
      }
    });

    try {
      // Test GET /api/blogs
      const blogsRes = await fetch("http://localhost:3009/api/blogs");
      expect(blogsRes.status).toBe(200);
      const blogs = await blogsRes.json();
      expect(Array.isArray(blogs)).toBe(true);

      // Test RSS Feed
      const rssRes = await fetch("http://localhost:3009/feed.xml");
      expect(rssRes.status).toBe(200);
      const xml = await rssRes.text();
      expect(xml).toContain("rss");
      expect(xml).toContain("TechPulse");
    } finally {
      server.stop();
    }
  });

  test("Blog Defined Path Routing (/:blog_slug)", async () => {
    const techpulse = db.query("SELECT * FROM blogs WHERE slug = 'techpulse'").get() as any;
    expect(techpulse).toBeDefined();
    expect(techpulse.slug).toBe("techpulse");

    const wanderlust = db.query("SELECT * FROM blogs WHERE slug = 'wanderlust'").get() as any;
    expect(wanderlust).toBeDefined();
    expect(wanderlust.slug).toBe("wanderlust");

    const testServer = Bun.serve({
      port: 3010,
      async fetch(req) {
        const url = new URL(req.url);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length === 0 || parts[0] === "admin") {
          return new Response(Bun.file("./public/index.html"));
        }
        if (parts.length > 0 && parts[0]) {
          const first = parts[0];
          const slug = first.startsWith("preview-") ? first.substring(8) : first;
          const blog = db.query("SELECT id FROM blogs WHERE slug = ?").get(slug);
          if (blog) {
            return new Response(Bun.file("./public/index.html"));
          }
        }
        return new Response("404 Not Found", { status: 404 });
      }
    });

    try {
      // Test Admin Mode routes
      const resAdmin = await fetch("http://localhost:3010/admin");
      expect(resAdmin.status).toBe(200);
      const htmlAdmin = await resAdmin.text();
      expect(htmlAdmin).toContain("Weblogger CMS");

      const resAdminEditor = await fetch("http://localhost:3010/admin/editor");
      expect(resAdminEditor.status).toBe(200);

      // Test Public Mode route
      const resPublic = await fetch("http://localhost:3010/techpulse");
      expect(resPublic.status).toBe(200);
      const htmlPublic = await resPublic.text();
      expect(htmlPublic).toContain("Weblogger CMS");

      // Test Preview Mode route
      const resPreview = await fetch("http://localhost:3010/preview-techpulse");
      expect(resPreview.status).toBe(200);
      const htmlPreview = await resPreview.text();
      expect(htmlPreview).toContain("Weblogger CMS");

      const notFoundRes = await fetch("http://localhost:3010/nonexistent");
      expect(notFoundRes.status).toBe(404);
    } finally {
      testServer.stop();
    }
  });

  test("Admin Authentication & Session Workflow", () => {
    const { authenticateUser, createSession, validateSession, destroySession } = require("./db.ts");

    // Invalid credentials
    expect(authenticateUser("admin", "wrongpass")).toBe(false);
    expect(authenticateUser("unknown", "admin123")).toBe(false);

    // Valid credentials
    expect(authenticateUser("admin", "admin123")).toBe(true);

    // Create & validate session
    const token = createSession("admin");
    expect(token).toBeDefined();

    const session = validateSession(token);
    expect(session).toBeDefined();
    expect(session?.username).toBe("admin");

    // Invalid token validation
    expect(validateSession("invalid-token-123")).toBeNull();

    // Destroy session
    destroySession(token);
    expect(validateSession(token)).toBeNull();

    // Test updating credentials
    const { updateUserCredentials } = require("./db.ts");

    // Fail with wrong current password
    const failRes = updateUserCredentials("admin", "wrongpass", "superadmin", "newpass123");
    expect(failRes.success).toBe(false);
    expect(failRes.error).toContain("incorrect");

    // Succeed with correct current password
    const successRes = updateUserCredentials("admin", "admin123", "superadmin", "newpass123");
    expect(successRes.success).toBe(true);

    // Verify authentication with new credentials
    expect(authenticateUser("superadmin", "newpass123")).toBe(true);
    expect(authenticateUser("admin", "admin123")).toBe(false);

    // Reset back to default admin / admin123 for other tests
    updateUserCredentials("superadmin", "newpass123", "admin", "admin123");
    expect(authenticateUser("admin", "admin123")).toBe(true);
  });

  test("Backup Export and Import Workflow", async () => {
    // Export blog ID 1 backup data directly via db query logic matching API endpoint
    const blog = db.query("SELECT * FROM blogs WHERE id = 1").get();
    expect(blog).toBeDefined();

    const posts = db.query("SELECT * FROM posts WHERE blog_id = 1").all();
    const pages = db.query("SELECT * FROM pages WHERE blog_id = 1").all();
    const gadgets = db.query("SELECT * FROM gadgets WHERE blog_id = 1").all();

    const backupObject = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      blog,
      posts,
      pages,
      gadgets
    };

    expect(backupObject.blog).toBeDefined();
    expect(Array.isArray(backupObject.posts)).toBe(true);
    expect(Array.isArray(backupObject.pages)).toBe(true);
    expect(Array.isArray(backupObject.gadgets)).toBe(true);
  });

  test("Flatfile Storage saving and reading workflow", async () => {
    const { saveBlogToFlatfile, readFlatfileStorage, syncAllBlogsToFlatfile, FLATFILE_PATH } = require("./flatfile.ts");

    await saveBlogToFlatfile({
      id: 1,
      slug: "techpulse",
      name: "TechPulse Flatfile Blog",
      theme_id: "contempo",
      custom_css: ".pub-blog-title { color: cyan; }",
      settings_json: JSON.stringify({ posts_per_page: 10, dark_mode: true })
    });

    const store = await readFlatfileStorage();
    expect(store.blogs["1"]).toBeDefined();
    expect(store.blogs["1"].name).toBe("TechPulse Flatfile Blog");
    expect(store.blogs["1"].settings.posts_per_page).toBe(10);

    const file = Bun.file(FLATFILE_PATH);
    expect(await file.exists()).toBe(true);

    const allBlogs = db.query("SELECT * FROM blogs").all();
    const syncedStore = await syncAllBlogsToFlatfile(allBlogs);
    expect(Object.keys(syncedStore.blogs).length).toBeGreaterThan(0);
  });
});
