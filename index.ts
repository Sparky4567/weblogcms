import { db, seedDatabase, authenticateUser, createSession, validateSession, destroySession, updateUserCredentials, generateOtpSecret, verifyOtp, verifyTotpCode, verifyOtpCode, isOtpEnabled, getOtpSecret, getOtpUri, getOtpQrCode, enableOtp, disableOtp, setOtpEnabled, generateOtpCode, getCurrentOtp, getOtpToken } from "./db.ts";
import { saveBlogToFlatfile, readFlatfileStorage, syncAllBlogsToFlatfile } from "./flatfile.ts";
import path from "path";

const PORT = Number(process.env.PORT) || 3000;

function getAuthToken(req: Request): string | null {
  const headerToken = req.headers.get("x-admin-token") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (headerToken) return headerToken;

  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    if (match && match[1]) return match[1];
  }
  return null;
}

// Helper to serve JSON
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

// Helper to sanitize slug
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Bun Server
const server = Bun.serve({
  port: PORT,
  development: true,

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Serve Static Files for App
    if (pathname === "/app.js") {
      return new Response(Bun.file("./public/app.js"), {
        headers: { "Content-Type": "application/javascript" }
      });
    }
    if (pathname === "/styles.css") {
      return new Response(Bun.file("./public/styles.css"), {
        headers: { "Content-Type": "text/css" }
      });
    }
    if (pathname === "/sw.js") {
      return new Response(Bun.file("./public/sw.js"), {
        headers: { "Content-Type": "application/javascript" }
      });
    }

    // RSS Feed (supports /feed.xml, /rss, /:slug/feed.xml, /:slug/rss)
    if (pathname.endsWith("/feed.xml") || pathname.endsWith("/rss")) {
      let blog: any = null;
      const blogIdParam = url.searchParams.get("blog_id");
      const blogSlugParam = url.searchParams.get("blog_slug");

      if (blogIdParam) {
        blog = db.query("SELECT * FROM blogs WHERE id = ?").get(Number(blogIdParam));
      } else if (blogSlugParam) {
        blog = db.query("SELECT * FROM blogs WHERE slug = ?").get(blogSlugParam);
      } else {
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && parts[0]) {
          blog = db.query("SELECT * FROM blogs WHERE slug = ?").get(parts[0]);
        }
        if (!blog) {
          blog = db.query("SELECT * FROM blogs ORDER BY id ASC LIMIT 1").get();
        }
      }

      if (!blog) return new Response("Blog not found", { status: 404 });

      const posts = db.query("SELECT * FROM posts WHERE blog_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 20")
        .all(blog.id) as any[];

      const domain = `${url.protocol}//${url.host}`;
      let rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(blog.name)}</title>
  <link>${domain}/${blog.slug}</link>
  <description>${escapeXml(blog.description || '')}</description>
  <language>en-us</language>
  <atom:link href="${domain}/${blog.slug}/feed.xml" rel="self" type="application/rss+xml" />
`;

      for (const p of posts) {
        rssXml += `  <item>
    <title>${escapeXml(p.title)}</title>
    <link>${domain}/${blog.slug}/post/${p.slug}</link>
    <guid>${domain}/${blog.slug}/post/${p.slug}</guid>
    <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
    <description>${escapeXml(p.excerpt || p.content)}</description>
  </item>\n`;
      }

      rssXml += `</channel>\n</rss>`;

      return new Response(rssXml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" }
      });
    }

    // HTML Page & Blog Defined Path Routing (e.g. localhost:3000/techpulse)
    if (method === "GET" && !pathname.startsWith("/api/")) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length === 0 || parts[0] === "admin" || pathname === "/index.html") {
        return new Response(Bun.file("./public/index.html"));
      }

      const firstSegment = parts[0] || "";
      const blogSlug = firstSegment.startsWith("preview-")
        ? firstSegment.substring(8)
        : firstSegment;
      const blog = db.query("SELECT id FROM blogs WHERE slug = ?").get(blogSlug);
      if (blog) {
        return new Response(Bun.file("./public/index.html"));
      }

      // If no matching blog is found for path segment, return 404
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Blog Route Not Found</title>
  <link rel="stylesheet" href="/styles.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px; }
    .not-found-card { background: rgba(17, 24, 39, 0.95); padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); max-width: 480px; width: 100%; box-shadow: 0 0 30px rgba(0,0,0,0.5); }
    h1 { font-size: 3.5rem; font-weight: 900; color: #f43f5e; margin-bottom: 8px; }
    h2 { font-size: 1.3rem; font-weight: 700; color: white; margin-bottom: 12px; }
    p { color: #9ca3af; margin-bottom: 24px; font-size: 0.95rem; }
    code { background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="not-found-card">
    <h1>404</h1>
    <h2>Blog Path Not Found</h2>
    <p>No weblog is configured at path <code>/${escapeXml(firstSegment)}</code>.</p>
    <a href="/" class="btn btn-primary">Go to Main Weblog</a>
  </div>
</body>
</html>`, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // API ROUTES
    try {
      // AUTH API
      if (pathname === "/api/auth/login" && method === "POST") {
        const body: any = await req.json();
        const { username, password } = body;
        const otp = body.otp || body.code || body.otp_code || body.totp || body.otp_token;

        const user = db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
        if (!user || user.password !== password) {
          return jsonResponse({ error: "Invalid username or password" }, 401);
        }

        if (user.otp_enabled) {
          if (!otp) {
            return jsonResponse({ success: false, requires_otp: true, otp_required: true, mfa_required: true, message: "OTP code required" }, 200);
          }
          if (!verifyTotpCode(user.otp_secret, otp)) {
            return jsonResponse({ error: "Invalid OTP code" }, 401);
          }
        }

        const token = createSession(username);
        return jsonResponse({ success: true, token, username });
      }

      // OTP / 2FA SECURITY ENDPOINTS
      if (pathname.startsWith("/api/auth/") && /otp|2fa|mfa|totp/i.test(pathname)) {
        const body = (method === "POST" ? await req.json().catch(() => ({})) : {}) as any;
        const token = getAuthToken(req);
        const session = validateSession(token);

        // GET status/secret/setup
        if (method === "GET") {
          if (!session) return jsonResponse({ error: "Unauthorized access" }, 401);
          if (/status/i.test(pathname)) {
            const enabled = isOtpEnabled(session.username);
            return jsonResponse({ enabled, otp_enabled: enabled, is_enabled: enabled, secret: getOtpSecret(session.username) });
          }
          if (/secret|setup|generate|create/i.test(pathname)) {
            let secret = getOtpSecret(session.username);
            if (!secret) secret = generateOtpSecret(session.username);
            return jsonResponse({ secret, otp_secret: secret, uri: getOtpUri(session.username, secret), otpauth_url: getOtpUri(session.username, secret), qr: getOtpUri(session.username, secret) });
          }
          const enabled = isOtpEnabled(session.username);
          return jsonResponse({ enabled, otp_enabled: enabled, secret: getOtpSecret(session.username) });
        }

        if (method === "POST") {
          const action = pathname.toLowerCase();
          const username = session?.username || body.username || body.user;

          // verify code (login flow or validation)
          if (/verify|validate|check|confirm/i.test(action)) {
            const code = body.code || body.otp || body.otp_code || body.totp || body.token || body.otp_token;
            let targetUser = username;
            let secret = body.secret || body.otp_secret;
            if (!secret && targetUser) secret = getOtpSecret(targetUser);
            let ok = false;
            if (targetUser && secret) ok = verifyTotpCode(secret, code);
            if (targetUser && !secret) ok = verifyOtp(targetUser, code);
            // If password provided, validate full auth and issue session
            if (ok && body.username && body.password) {
              if (authenticateUser(body.username, body.password, code)) {
                const t = createSession(body.username);
                return jsonResponse({ success: true, valid: true, verified: true, token: t, username: body.username });
              }
              return jsonResponse({ error: "Invalid credentials" }, 401);
            }
            if (ok) {
              // login flow: if user not yet session but username provided, issue session? only if otp enabled user
              if (!session && body.username) {
                const u = db.query("SELECT * FROM users WHERE username = ?").get(body.username) as any;
                if (u && u.otp_enabled) {
                  const t = createSession(body.username);
                  return jsonResponse({ success: true, valid: true, verified: true, token: t, username: body.username });
                }
              }
              return jsonResponse({ success: true, valid: true, verified: true });
            }
            return jsonResponse({ success: false, valid: false, verified: false, error: "Invalid OTP code" }, 400);
          }

          // enable
          if (/enable/i.test(action)) {
            if (!session) return jsonResponse({ error: "Unauthorized access" }, 401);
            const secret = body.secret || body.otp_secret || getOtpSecret(session.username) || generateOtpSecret(session.username);
            const code = body.code || body.otp || body.otp_code || body.totp || body.token || body.otp_token;
            const res = enableOtp(session.username, secret, code);
            if (res.success) {
              return jsonResponse({ success: true, message: "OTP enabled", secret, otp_secret: secret, uri: getOtpUri(session.username, secret) });
            }
            return jsonResponse({ error: res.error || "Failed to enable OTP" }, 400);
          }

          // disable
          if (/disable/i.test(action)) {
            if (!session) return jsonResponse({ error: "Unauthorized access" }, 401);
            const code = body.code || body.otp || body.otp_code || body.totp || body.token || body.otp_token;
            if (isOtpEnabled(session.username) && code) {
              const sec = getOtpSecret(session.username);
              if (sec && !verifyTotpCode(sec, code)) return jsonResponse({ error: "Invalid OTP code" }, 400);
            }
            const pw = body.password || body.current_password;
            const res = disableOtp(session.username, pw);
            if (res.success) return jsonResponse({ success: true, message: "OTP disabled" });
            return jsonResponse({ error: res.error || "Failed to disable OTP" }, 400);
          }

          // generate/setup secret
          if (/generate|setup|create|secret/i.test(action)) {
            if (!session) return jsonResponse({ error: "Unauthorized access" }, 401);
            const secret = generateOtpSecret(session.username);
            return jsonResponse({ secret, otp_secret: secret, uri: getOtpUri(session.username, secret), otpauth_url: getOtpUri(session.username, secret) });
          }

          // default: if code provided, verify; else status
          if (body.code || body.otp) {
            const code = body.code || body.otp || body.otp_code || body.totp || body.token || body.otp_token;
            const sec = body.secret || body.otp_secret || (username ? getOtpSecret(username) : null);
            let ok = false;
            if (sec) ok = verifyTotpCode(sec, code);
            else if (username) ok = verifyOtp(username, code);
            return jsonResponse({ success: ok, valid: ok, verified: ok }, ok ? 200 : 400);
          }

          if (session) {
            const enabled = isOtpEnabled(session.username);
            return jsonResponse({ enabled, otp_enabled: enabled, secret: getOtpSecret(session.username) });
          }
          return jsonResponse({ error: "Bad request" }, 400);
        }

        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      if (pathname === "/api/auth/logout" && method === "POST") {
        const token = getAuthToken(req);
        destroySession(token);
        return jsonResponse({ success: true, message: "Logged out" });
      }

      if (pathname === "/api/auth/check" && method === "GET") {
        const token = getAuthToken(req);
        const session = validateSession(token);
        if (session) {
          return jsonResponse({ authenticated: true, username: session.username });
        }
        return jsonResponse({ authenticated: false }, 200);
      }

      if (pathname === "/api/auth/credentials" && method === "PUT") {
        const token = getAuthToken(req);
        const session = validateSession(token);
        if (!session) {
          return jsonResponse({ error: "Unauthorized access" }, 401);
        }

        const body: any = await req.json();
        const { current_password, new_username, new_password } = body;

        if (!current_password || !new_username || !new_password) {
          return jsonResponse({ error: "All fields (current password, new username, new password) are required" }, 400);
        }

        if (new_password.length < 4) {
          return jsonResponse({ error: "New password must be at least 4 characters long" }, 400);
        }

        const res = updateUserCredentials(session.username, current_password, new_username, new_password);
        if (res.success) {
          return jsonResponse({ success: true, message: "Credentials updated successfully", username: new_username });
        } else {
          return jsonResponse({ error: res.error || "Update failed" }, 400);
        }
      }

      // BLOGS API
      if (pathname === "/api/blogs" && method === "GET") {
        const blogs = db.query("SELECT * FROM blogs ORDER BY id ASC").all();
        return jsonResponse(blogs);
      }

      if (pathname === "/api/blogs" && method === "POST") {
        const body: any = await req.json();
        const name = body.name || "My New Blog";
        let slug = body.slug ? slugify(body.slug) : slugify(name);
        // ensure unique slug
        const existing = db.query("SELECT id FROM blogs WHERE slug = ?").get(slug);
        if (existing) {
          slug = `${slug}-${Date.now().toString().slice(-4)}`;
        }
        const description = body.description || "";
        const author_name = body.author_name || "Admin Author";
        const theme_id = body.theme_id || "contempo";

        const settings = JSON.stringify({
          posts_per_page: 5,
          comments_enabled: true,
          dark_mode: true,
          accent_color: "#6366f1",
          background_color: "#0f172a",
          font_family: "Inter",
          layout_style: "sidebar-right",
          header_image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80"
        });

        const res = db.prepare(`
          INSERT INTO blogs (name, slug, description, author_name, theme_id, settings_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, slug, description, author_name, theme_id, settings);

        const newBlogId = Number(res.lastInsertRowid);

        // Add default gadgets for new blog
        const insertGadget = db.prepare("INSERT INTO gadgets (blog_id, type, title, section, position, config_json) VALUES (?, ?, ?, ?, ?, ?)");
        insertGadget.run(newBlogId, "profile", "About Me", "sidebar", 1, JSON.stringify({ show_avatar: true }));
        insertGadget.run(newGadgetBlogId(newBlogId), "search", "Search Blog", "sidebar", 2, JSON.stringify({}));
        insertGadget.run(newBlogId, "popular_posts", "Popular Posts", "sidebar", 3, JSON.stringify({ limit: 5 }));
        insertGadget.run(newBlogId, "labels", "Tags", "sidebar", 4, JSON.stringify({ display_style: "cloud" }));

        const created: any = db.query("SELECT * FROM blogs WHERE id = ?").get(newBlogId);
        await saveBlogToFlatfile(created);
        return jsonResponse(created, 201);
      }

      if (pathname.startsWith("/api/blogs/") && method === "GET") {
        const id = pathname.split("/")[3] || "";
        const blog = db.query("SELECT * FROM blogs WHERE id = ? OR slug = ?").get(id, id);
        if (!blog) return jsonResponse({ error: "Blog not found" }, 404);
        return jsonResponse(blog);
      }

      if (pathname.startsWith("/api/blogs/") && method === "PUT") {
        const id = Number(pathname.split("/")[3]);
        const body: any = await req.json();

        const existing = db.query("SELECT * FROM blogs WHERE id = ?").get(id) as any;
        if (!existing) return jsonResponse({ error: "Blog not found" }, 404);

        const name = body.name !== undefined ? body.name : existing.name;
        const slug = body.slug ? slugify(body.slug) : existing.slug;
        const description = body.description !== undefined ? body.description : existing.description;
        const author_name = body.author_name !== undefined ? body.author_name : existing.author_name;
        const author_bio = body.author_bio !== undefined ? body.author_bio : existing.author_bio;
        const author_avatar = body.author_avatar !== undefined ? body.author_avatar : existing.author_avatar;
        const theme_id = body.theme_id !== undefined ? body.theme_id : existing.theme_id;
        const custom_css = body.custom_css !== undefined ? body.custom_css : existing.custom_css;

        let settings_json = existing.settings_json || "{}";
        if (body.settings_json !== undefined) {
          let existingObj = {};
          try { existingObj = JSON.parse(settings_json); } catch(e){}
          let newObj = typeof body.settings_json === 'object' ? body.settings_json : {};
          if (typeof body.settings_json === 'string') {
            try { newObj = JSON.parse(body.settings_json); } catch(e){}
          }
          settings_json = JSON.stringify({ ...existingObj, ...newObj });
        }

        db.prepare(`
          UPDATE blogs
          SET name = ?,
              slug = ?,
              description = ?,
              author_name = ?,
              author_bio = ?,
              author_avatar = ?,
              theme_id = ?,
              custom_css = ?,
              settings_json = ?
          WHERE id = ?
        `).run(
          name,
          slug,
          description,
          author_name,
          author_bio,
          author_avatar,
          theme_id,
          custom_css,
          settings_json,
          id
        );

        const updated: any = db.query("SELECT * FROM blogs WHERE id = ?").get(id);
        await saveBlogToFlatfile(updated);
        return jsonResponse(updated);
      }

      if (pathname.startsWith("/api/blogs/") && method === "DELETE") {
        const id = Number(pathname.split("/")[3]);
        db.prepare("DELETE FROM blogs WHERE id = ?").run(id);
        return jsonResponse({ success: true, message: "Blog deleted" });
      }

      // POSTS API
      if (pathname === "/api/posts" && method === "GET") {
        const blog_id = Number(url.searchParams.get("blog_id")) || 1;
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search");
        const label = url.searchParams.get("label");

        let query = "SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count FROM posts p WHERE p.blog_id = ?";
        const params: any[] = [blog_id];

        if (status) {
          query += " AND p.status = ?";
          params.push(status);
        }
        if (search) {
          query += " AND (p.title LIKE ? OR p.content LIKE ?)";
          params.push(`%${search}%`, `%${search}%`);
        }
        if (label) {
          query += " AND p.labels LIKE ?";
          params.push(`%${label}%`);
        }

        query += " ORDER BY p.published_at DESC";
        const posts = db.query(query).all(...params);
        return jsonResponse(posts);
      }

      if (pathname === "/api/posts" && method === "POST") {
        const body: any = await req.json();
        let blog_id = Number(body.blog_id) || 1;

        // Verify blog_id exists in blogs table
        const blogExists = db.query("SELECT id FROM blogs WHERE id = ?").get(blog_id);
        if (!blogExists) {
          const firstBlog = db.query("SELECT id FROM blogs ORDER BY id ASC LIMIT 1").get() as any;
          if (firstBlog) blog_id = firstBlog.id;
          else return jsonResponse({ error: "No active blog found" }, 400);
        }

        const title = body.title || "Untitled Post";
        let slug = body.slug ? slugify(body.slug) : slugify(title);
        if (!slug) slug = `post-${Date.now()}`;
        const content = body.content || "";
        const excerpt = body.excerpt || createExcerpt(content);
        const status = body.status || "published";
        const labels = body.labels || "";
        const cover_image = body.cover_image || "";
        const author_name = body.author_name || "Admin Author";

        const res = db.prepare(`
          INSERT INTO posts (blog_id, title, slug, content, excerpt, status, labels, cover_image, author_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(blog_id, title, slug, content, excerpt, status, labels, cover_image, author_name);

        const newPost = db.query("SELECT * FROM posts WHERE id = ?").get(res.lastInsertRowid);
        return jsonResponse(newPost, 201);
      }

      if (pathname.startsWith("/api/posts/") && method === "GET") {
        const id = pathname.split("/")[3] || "";
        let post;
        if (/^\d+$/.test(id)) {
          post = db.query("SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') as comment_count FROM posts p WHERE p.id = ?").get(Number(id));
        } else {
          post = db.query("SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') as comment_count FROM posts p WHERE p.slug = ?").get(id);
        }

        if (!post) return jsonResponse({ error: "Post not found" }, 404);

        // Increment views
        db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run((post as any).id);
        return jsonResponse(post);
      }

      if (pathname.startsWith("/api/posts/") && method === "PUT") {
        const id = Number(pathname.split("/")[3]);
        const body: any = await req.json();

        const existing = db.query("SELECT * FROM posts WHERE id = ?").get(id) as any;
        if (!existing) return jsonResponse({ error: "Post not found" }, 404);

        const newContent = body.content !== undefined ? body.content : existing.content;
        const newExcerpt = body.excerpt || (body.content !== undefined ? createExcerpt(newContent) : existing.excerpt);

        db.prepare(`
          UPDATE posts
          SET title = COALESCE(?, title),
              slug = COALESCE(?, slug),
              content = COALESCE(?, content),
              excerpt = ?,
              status = COALESCE(?, status),
              labels = COALESCE(?, labels),
              cover_image = COALESCE(?, cover_image),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          body.title,
          body.slug ? slugify(body.slug) : null,
          body.content,
          newExcerpt,
          body.status,
          body.labels,
          body.cover_image,
          id
        );

        const updated = db.query("SELECT * FROM posts WHERE id = ?").get(id);
        return jsonResponse(updated);
      }

      if (pathname.startsWith("/api/posts/") && method === "DELETE") {
        const id = Number(pathname.split("/")[3]);

        // Explicitly clean up comments and analytics before deleting post
        db.prepare("DELETE FROM comments WHERE post_id = ?").run(id);
        db.prepare("DELETE FROM analytics WHERE post_id = ?").run(id);
        db.prepare("DELETE FROM posts WHERE id = ?").run(id);

        return jsonResponse({ success: true, message: "Post deleted" });
      }

      // PAGES API
      if (pathname === "/api/pages" && method === "GET") {
        const blog_id = Number(url.searchParams.get("blog_id")) || 1;
        const pages = db.query("SELECT * FROM pages WHERE blog_id = ? ORDER BY id ASC").all(blog_id);
        return jsonResponse(pages);
      }

      if (pathname === "/api/pages" && method === "POST") {
        const body: any = await req.json();
        const blog_id = Number(body.blog_id) || 1;
        const title = body.title || "New Page";
        const slug = body.slug ? slugify(body.slug) : slugify(title);
        const content = body.content || "";
        const meta_description = (body.meta_description && body.meta_description.trim()) ? body.meta_description.trim() : createExcerpt(content);
        const status = body.status || "published";

        const res = db.prepare("INSERT INTO pages (blog_id, title, slug, content, meta_description, status) VALUES (?, ?, ?, ?, ?, ?)").run(
          blog_id, title, slug, content, meta_description, status
        );
        const created = db.query("SELECT * FROM pages WHERE id = ?").get(res.lastInsertRowid);
        return jsonResponse(created, 201);
      }

      if (pathname.startsWith("/api/pages/") && method === "GET") {
        const id = pathname.split("/")[3] || "";
        const page = db.query("SELECT * FROM pages WHERE id = ? OR slug = ?").get(id, id);
        if (!page) return jsonResponse({ error: "Page not found" }, 404);
        return jsonResponse(page);
      }

      if (pathname.startsWith("/api/pages/") && method === "PUT") {
        const id = Number(pathname.split("/")[3]);
        const body: any = await req.json();

        const existingPage = db.query("SELECT * FROM pages WHERE id = ?").get(id) as any;
        if (!existingPage) return jsonResponse({ error: "Page not found" }, 404);

        const newContent = body.content !== undefined ? body.content : existingPage.content;
        let meta_description = body.meta_description !== undefined ? body.meta_description.trim() : existingPage.meta_description;

        if (!meta_description) {
          meta_description = createExcerpt(newContent);
        }

        db.prepare(`
          UPDATE pages
          SET title = COALESCE(?, title),
              slug = COALESCE(?, slug),
              content = COALESCE(?, content),
              meta_description = ?,
              status = COALESCE(?, status),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          body.title,
          body.slug ? slugify(body.slug) : null,
          body.content,
          meta_description,
          body.status,
          id
        );

        const updated = db.query("SELECT * FROM pages WHERE id = ?").get(id);
        return jsonResponse(updated);
      }

      if (pathname.startsWith("/api/pages/") && method === "DELETE") {
        const id = Number(pathname.split("/")[3]);
        db.prepare("DELETE FROM pages WHERE id = ?").run(id);
        return jsonResponse({ success: true });
      }

      // COMMENTS API
      if (pathname === "/api/comments" && method === "GET") {
        const post_id = url.searchParams.get("post_id");
        const status = url.searchParams.get("status");
        const blog_id = url.searchParams.get("blog_id") || 1;

        let query = `
          SELECT c.*, p.title as post_title, p.slug as post_slug
          FROM comments c
          JOIN posts p ON c.post_id = p.id
          WHERE p.blog_id = ?
        `;
        const params: any[] = [blog_id];

        if (post_id) {
          query += " AND c.post_id = ?";
          params.push(post_id);
        }
        if (status) {
          query += " AND c.status = ?";
          params.push(status);
        }

        query += " ORDER BY c.created_at DESC";
        const comments = db.query(query).all(...params);
        return jsonResponse(comments);
      }

      if (pathname === "/api/comments" && method === "POST") {
        const body: any = await req.json();
        const post_id = Number(body.post_id);
        const author_name = body.author_name || "Anonymous Reader";
        const author_email = body.author_email || "";
        const content = body.content || "";
        const author_avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(author_name)}`;

        if (!post_id || !content) {
          return jsonResponse({ error: "Missing post_id or content" }, 400);
        }

        const res = db.prepare(`
          INSERT INTO comments (post_id, author_name, author_email, author_avatar, content, status)
          VALUES (?, ?, ?, ?, ?, 'approved')
        `).run(post_id, author_name, author_email, author_avatar, content);

        const newComment = db.query("SELECT * FROM comments WHERE id = ?").get(res.lastInsertRowid);
        return jsonResponse(newComment, 201);
      }

      if (pathname.startsWith("/api/comments/") && method === "PUT") {
        const id = Number(pathname.split("/")[3]);
        const body: any = await req.json();
        db.prepare("UPDATE comments SET status = ? WHERE id = ?").run(body.status, id);
        const updated = db.query("SELECT * FROM comments WHERE id = ?").get(id);
        return jsonResponse(updated);
      }

      if (pathname.startsWith("/api/comments/") && method === "DELETE") {
        const id = Number(pathname.split("/")[3]);
        db.prepare("DELETE FROM comments WHERE id = ?").run(id);
        return jsonResponse({ success: true });
      }

      // GADGETS (LAYOUT) API
      if (pathname === "/api/gadgets" && method === "GET") {
        const blog_id = Number(url.searchParams.get("blog_id")) || 1;
        const gadgets = db.query("SELECT * FROM gadgets WHERE blog_id = ? ORDER BY section ASC, position ASC").all(blog_id);
        return jsonResponse(gadgets);
      }

      if (pathname === "/api/gadgets" && method === "POST") {
        const body: any = await req.json();
        const blog_id = Number(body.blog_id) || 1;
        const type = body.type || "text";
        const title = body.title || "Custom Gadget";
        const section = body.section || "sidebar";
        const config_json = typeof body.config_json === 'object' ? JSON.stringify(body.config_json) : (body.config_json || '{}');

        // max position in section
        const posResult = db.query("SELECT MAX(position) as max_pos FROM gadgets WHERE blog_id = ? AND section = ?").get(blog_id, section) as any;
        const position = (posResult?.max_pos || 0) + 1;

        const res = db.prepare(`
          INSERT INTO gadgets (blog_id, type, title, section, position, config_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(blog_id, type, title, section, position, config_json);

        const newGadget = db.query("SELECT * FROM gadgets WHERE id = ?").get(res.lastInsertRowid);
        return jsonResponse(newGadget, 201);
      }

      if (pathname === "/api/gadgets/reorder" && method === "PUT") {
        const body: any = await req.json(); // Array of { id, section, position }
        if (Array.isArray(body)) {
          const updateStmt = db.prepare("UPDATE gadgets SET section = ?, position = ? WHERE id = ?");
          for (const item of body) {
            updateStmt.run(item.section, item.position, item.id);
          }
        }
        return jsonResponse({ success: true });
      }

      if (pathname.startsWith("/api/gadgets/") && method === "PUT") {
        const id = Number(pathname.split("/")[3]);
        const body: any = await req.json();
        const existing = db.query("SELECT * FROM gadgets WHERE id = ?").get(id) as any;
        if (!existing) return jsonResponse({ error: "Gadget not found" }, 404);

        const newTitle = body.title !== undefined ? body.title : existing.title;
        const newType = body.type !== undefined ? body.type : existing.type;
        const newSection = body.section !== undefined ? body.section : existing.section;
        const newIsEnabled = body.is_enabled !== undefined ? (body.is_enabled ? 1 : 0) : existing.is_enabled;
        const newPosition = body.position !== undefined ? body.position : existing.position;
        
        let newConfigJson = existing.config_json;
        if (body.config_json !== undefined) {
          newConfigJson = typeof body.config_json === 'object' ? JSON.stringify(body.config_json) : body.config_json;
        }

        db.prepare(`
          UPDATE gadgets
          SET title = ?,
              type = ?,
              section = ?,
              is_enabled = ?,
              position = ?,
              config_json = ?
          WHERE id = ?
        `).run(
          newTitle,
          newType,
          newSection,
          newIsEnabled,
          newPosition,
          newConfigJson,
          id
        );
        const updated = db.query("SELECT * FROM gadgets WHERE id = ?").get(id);
        return jsonResponse(updated);
      }

      if (pathname.startsWith("/api/gadgets/") && method === "DELETE") {
        const id = Number(pathname.split("/")[3]);
        db.prepare("DELETE FROM gadgets WHERE id = ?").run(id);
        return jsonResponse({ success: true });
      }

      // STATS & ANALYTICS API
      if (pathname === "/api/stats" && method === "GET") {
        const blog_id = Number(url.searchParams.get("blog_id")) || 1;

        const totalViews = db.query("SELECT SUM(views) as total FROM posts WHERE blog_id = ?").get(blog_id) as any;
        const totalPosts = db.query("SELECT COUNT(*) as total FROM posts WHERE blog_id = ?").get(blog_id) as any;
        const totalComments = db.query("SELECT COUNT(*) as total FROM comments c JOIN posts p ON c.post_id = p.id WHERE p.blog_id = ?").get(blog_id) as any;

        const topPosts = db.query("SELECT id, title, slug, views FROM posts WHERE blog_id = ? ORDER BY views DESC LIMIT 5").all(blog_id);

        const referrers = db.query("SELECT referrer, COUNT(*) as count FROM analytics WHERE blog_id = ? GROUP BY referrer ORDER BY count DESC LIMIT 6").all(blog_id);

        const browsers = db.query("SELECT browser, COUNT(*) as count FROM analytics WHERE blog_id = ? GROUP BY browser ORDER BY count DESC").all(blog_id);

        const devices = db.query("SELECT device, COUNT(*) as count FROM analytics WHERE blog_id = ? GROUP BY device ORDER BY count DESC").all(blog_id);

        return jsonResponse({
          total_views: totalViews?.total || 0,
          total_posts: totalPosts?.total || 0,
          total_comments: totalComments?.total || 0,
          top_posts: topPosts,
          referrers,
          browsers,
          devices
        });
      }

      if (pathname === "/api/track" && method === "POST") {
        const body: any = await req.json();
        const blog_id = Number(body.blog_id) || 1;
        const post_id = body.post_id ? Number(body.post_id) : null;
        const referrer = body.referrer || "Direct";
        const browser = body.browser || "Chrome";
        const device = body.device || "Desktop";

        db.prepare("INSERT INTO analytics (blog_id, post_id, referrer, browser, device) VALUES (?, ?, ?, ?, ?)").run(
          blog_id, post_id, referrer, browser, device
        );

        if (post_id) {
          db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(post_id);
        }
        return jsonResponse({ tracked: true });
      }

      // BACKUP EXPORT / IMPORT / SEED API
      if (pathname === "/api/export" && method === "GET") {
        const blog_id = Number(url.searchParams.get("blog_id")) || 1;
        const blog = db.query("SELECT * FROM blogs WHERE id = ?").get(blog_id);
        const posts = db.query("SELECT * FROM posts WHERE blog_id = ?").all(blog_id);
        const pages = db.query("SELECT * FROM pages WHERE blog_id = ?").all(blog_id);
        const gadgets = db.query("SELECT * FROM gadgets WHERE blog_id = ?").all(blog_id);
        const comments = db.query("SELECT c.* FROM comments c JOIN posts p ON c.post_id = p.id WHERE p.blog_id = ?").all(blog_id);

        return jsonResponse({
          version: "1.0",
          exported_at: new Date().toISOString(),
          blog,
          posts,
          pages,
          gadgets,
          comments
        });
      }

      if (pathname === "/api/import" && method === "POST") {
        const data: any = await req.json();
        if (!data || !data.blog) {
          return jsonResponse({ error: "Invalid backup data structure" }, 400);
        }

        // Create imported blog
        const b = data.blog;
        const res = db.prepare("INSERT INTO blogs (name, slug, description, author_name, theme_id, settings_json) VALUES (?, ?, ?, ?, ?, ?)").run(
          `${b.name} (Imported)`,
          `${b.slug}-imp-${Date.now().toString().slice(-4)}`,
          b.description,
          b.author_name,
          b.theme_id || "contempo",
          b.settings_json || "{}"
        );
        const newBlogId = Number(res.lastInsertRowid);

        // Import posts
        if (Array.isArray(data.posts)) {
          const insertP = db.prepare("INSERT INTO posts (blog_id, title, slug, content, excerpt, status, labels, cover_image, author_name, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
          for (const p of data.posts) {
            insertP.run(newBlogId, p.title, p.slug, p.content, p.excerpt, p.status || 'published', p.labels, p.cover_image, p.author_name, p.views || 0);
          }
        }

        // Import pages
        if (Array.isArray(data.pages)) {
          const insertPg = db.prepare("INSERT INTO pages (blog_id, title, slug, content, status) VALUES (?, ?, ?, ?, ?)");
          for (const pg of data.pages) {
            insertPg.run(newBlogId, pg.title, pg.slug, pg.content, pg.status || 'published');
          }
        }

        // Import gadgets
        if (Array.isArray(data.gadgets)) {
          const insertG = db.prepare("INSERT INTO gadgets (blog_id, type, title, section, position, is_enabled, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
          for (const g of data.gadgets) {
            insertG.run(newBlogId, g.type, g.title, g.section, g.position, g.is_enabled ?? 1, g.config_json);
          }
        }

        const newBlog: any = db.query("SELECT * FROM blogs WHERE id = ?").get(newBlogId);
        if (newBlog) await saveBlogToFlatfile(newBlog);

        return jsonResponse({ success: true, new_blog_id: newBlogId });
      }

      if ((pathname === "/api/mock-data" || pathname === "/api/seed") && method === "POST") {
        seedDatabase();
        const allBlogs = db.query("SELECT * FROM blogs").all();
        await syncAllBlogsToFlatfile(allBlogs);
        return jsonResponse({ success: true, message: "Mock data restored successfully" });
      }

      if (pathname === "/api/flatfile/settings" && method === "GET") {
        const store = await readFlatfileStorage();
        return jsonResponse(store);
      }

      if (pathname === "/api/flatfile/sync" && method === "POST") {
        const allBlogs = db.query("SELECT * FROM blogs").all();
        const store = await syncAllBlogsToFlatfile(allBlogs);
        return jsonResponse({ success: true, store });
      }

      return jsonResponse({ error: "API Route Not Found" }, 404);
    } catch (err: any) {
      console.error("API Error:", err);
      return jsonResponse({ error: err.message || "Internal Server Error" }, 500);
    }
  }
});

function helperNewGadgetBlogId(id: number) { return id; }
function newGadgetBlogId(id: number) { return id; }

function createExcerpt(html: string): string {
  const plainText = html.replace(/<[^>]*>/g, "").trim();
  return plainText.length > 160 ? plainText.substring(0, 157) + "..." : plainText;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

console.log(`🚀 Weblogger CMS server running at http://localhost:${PORT}`);