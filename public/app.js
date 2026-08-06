/* ==========================================================================
   BLOGGER CMS JAVASCRIPT APPLICATION CORE
   ========================================================================== */

// Safe localStorage wrappers to prevent exceptions (e.g. quota, private browsing, blocked storage)
function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage getItem failed for "${key}":`, e);
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`localStorage setItem failed for "${key}":`, e);
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.warn(`localStorage removeItem failed for "${key}":`, e);
    return false;
  }
}

let currentBlogId = 1;
let currentBlogs = [];
let currentBlogData = null;
let currentView = "posts";
let activeCommentStatus = "approved";

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  setupEventListeners();
  await loadBlogsList();
  if (currentBlogs.length > 0) {
    await handleLocationRoute(false);
  }

  // Auto-save post draft listeners
  ["editor-title-input", "editor-slug-input", "editor-html", "editor-labels-input", "editor-cover-input"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", autoSavePostDraft);
  });
  const visualEd = document.getElementById("editor-visual");
  if (visualEd) visualEd.addEventListener("input", autoSavePostDraft);

  restorePostDraft();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

let currentAdminUser = null;

async function checkAuthStatus() {
  const token = safeLocalStorageGet("weblogger_admin_token");
  try {
    const res = await fetch("/api/auth/check", {
      headers: token ? { "x-admin-token": token } : {}
    });
    const data = await res.json();
    if (data.authenticated) {
      currentAdminUser = data.username;
      const display = document.getElementById("admin-user-display");
      if (display) display.textContent = `👤 ${data.username}`;
      const box = document.getElementById("admin-user-box");
      if (box) box.style.display = "flex";
      return true;
    }
  } catch (e) {}
  currentAdminUser = null;
  const box = document.getElementById("admin-user-box");
  if (box) box.style.display = "none";
  return false;
}

function fetchWithAuth(url, options = {}) {
  const token = safeLocalStorageGet("weblogger_admin_token");
  const headers = {
    ...options.headers,
    ...(token ? { "x-admin-token": token } : {})
  };
  return fetch(url, { ...options, headers });
}

async function handleLocationRoute(updateHistory = true) {
  const pathname = window.location.pathname;
  const segments = pathname.split("/").filter(Boolean);

  // ADMIN CMS ROUTE (/admin or /admin/:view or /)
  if (segments.length === 0 || segments[0] === "admin") {
    closeModal("modal-public-blog");

    const isAuthenticated = await checkAuthStatus();
    if (!isAuthenticated) {
      document.querySelectorAll(".app-view").forEach(el => el.style.display = "none");
      const subtitle = document.getElementById("login-modal-subtitle");
      if (subtitle) subtitle.textContent = "Authentication required to access admin panel.";
      openModal("modal-admin-login");
      return;
    }
    closeModal("modal-admin-login");

    let targetBlog = null;
    const savedBlogId = Number(safeLocalStorageGet("weblogger_active_blog_id"));
    const validSavedBlog = currentBlogs.find(b => b.id === savedBlogId);
    targetBlog = validSavedBlog || currentBlogs[0];
    if (targetBlog && (!currentBlogData || targetBlog.id !== currentBlogId)) {
      await switchBlog(targetBlog.id, false);
    }

    let adminView = "posts";
    if (segments.length >= 2) {
      adminView = segments[1];
    } else {
      adminView = safeLocalStorageGet("weblogger_active_view") || "posts";
    }

    if (!document.getElementById(`view-${adminView}`)) {
      adminView = "posts";
    }

    switchView(adminView, false);

    if (pathname === "/") {
      history.replaceState(null, "", `/admin/${adminView}`);
    } else if (segments.length === 1 && segments[0] === "admin") {
      history.replaceState(null, "", `/admin/${adminView}`);
    }
    return;
  }

  // PUBLIC / PREVIEW BLOG ROUTE
  let targetBlog = null;
  let isPreview = false;

  const rawFirst = segments[0];
  let requestedSlug = rawFirst;
  if (rawFirst.startsWith("preview-")) {
    isPreview = true;
    requestedSlug = rawFirst.substring(8);
  }

  if (isPreview) {
    const isAuthenticated = await checkAuthStatus();
    if (!isAuthenticated) {
      closeModal("modal-public-blog");
      history.replaceState(null, "", `/${requestedSlug}`);
      await handleLocationRoute(false);
      return;
    }
    closeModal("modal-admin-login");
  }

  targetBlog = currentBlogs.find(b => b.slug === requestedSlug);

  if (!targetBlog) {
    const savedBlogId = Number(safeLocalStorageGet("weblogger_active_blog_id"));
    const validSavedBlog = currentBlogs.find(b => b.id === savedBlogId);
    targetBlog = validSavedBlog || currentBlogs[0];
  }

  if (targetBlog) {
    if (!currentBlogData || targetBlog.id !== currentBlogId) {
      await switchBlog(targetBlog.id, updateHistory);
    }
  }

  if (targetBlog && (segments[0] === targetBlog.slug || segments[0] === `preview-${targetBlog.slug}`)) {
    let singlePostId = null;

    if (segments.length >= 3 && segments[1] === "post") {
      const postSlug = segments[2];
      try {
        const res = await fetch(`/api/posts?blog_id=${targetBlog.id}`);
        const posts = await res.json();
        const post = posts.find(p => p.slug === postSlug);
        if (post) singlePostId = post.id;
      } catch (e) {}
    }

    openPublicBlogReader(isPreview, singlePostId);
  } else {
    closeModal("modal-public-blog");
  }
}

// Global Event Listeners
function setupEventListeners() {
  // Navigation tabs
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const view = item.getAttribute("data-view");
      if (view === "editor") {
        resetPostEditor();
      }
      switchView(view);
    });
  });

  // Popstate Listener for Browser Back/Forward navigation across blog routes
  window.addEventListener("popstate", () => {
    handleLocationRoute(false);
  });

  // Mobile Sidebar Navigation
  const mobileToggle = document.getElementById("btn-toggle-mobile-sidebar");
  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => toggleMobileSidebar());
  }
  const backdrop = document.getElementById("sidebar-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", () => toggleMobileSidebar(false));
  }

  // Blog selector
  document.getElementById("blog-selector").addEventListener("change", (e) => {
    switchBlog(Number(e.target.value));
  });

  // Create blog modal
  document.getElementById("btn-open-create-blog").addEventListener("click", () => {
    openModal("modal-create-blog");
  });

  document.getElementById("form-create-blog").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-blog-name").value;
    const slug = document.getElementById("new-blog-slug").value;
    const description = document.getElementById("new-blog-desc").value;

    try {
      const res = await fetch("/api/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description })
      });
      const newBlog = await res.json();
      showToast(`Blog "${newBlog.name}" created!`);
      closeModal("modal-create-blog");
      document.getElementById("form-create-blog").reset();
      await loadBlogsList();
      switchBlog(newBlog.id);
    } catch (err) {
      showToast("Error creating blog", true);
    }
  });

  // Quick New Post buttons
  document.getElementById("btn-quick-new-post").addEventListener("click", () => {
    resetPostEditor();
    switchView("editor");
  });
  document.getElementById("btn-create-post-posts-view").addEventListener("click", () => {
    resetPostEditor();
    switchView("editor");
  });

  // Posts Filters
  document.getElementById("posts-search-input").addEventListener("input", debounce(loadPosts, 300));
  document.getElementById("posts-status-filter").addEventListener("change", loadPosts);

  // Editor Actions
  document.getElementById("btn-publish-post").addEventListener("click", () => savePost("published"));
  document.getElementById("btn-save-draft").addEventListener("click", () => savePost("draft"));

  // Toggle Editor Modes
  document.getElementById("toggle-wysiwyg-mode").addEventListener("click", () => {
    document.getElementById("editor-visual").style.display = "block";
    document.getElementById("wysiwyg-toolbar").style.display = "flex";
    document.getElementById("editor-html").style.display = "none";
    document.getElementById("toggle-wysiwyg-mode").style.background = "var(--accent-color)";
    document.getElementById("toggle-wysiwyg-mode").style.color = "white";
    document.getElementById("toggle-html-mode").style.background = "rgba(30, 41, 59, 0.8)";
    document.getElementById("toggle-html-mode").style.color = "var(--text-main)";

    // Sync HTML to visual
    document.getElementById("editor-visual").innerHTML = document.getElementById("editor-html").value;
  });

  document.getElementById("toggle-html-mode").addEventListener("click", () => {
    document.getElementById("editor-visual").style.display = "none";
    document.getElementById("wysiwyg-toolbar").style.display = "none";
    document.getElementById("editor-html").style.display = "block";
    document.getElementById("toggle-html-mode").style.background = "var(--accent-color)";
    document.getElementById("toggle-html-mode").style.color = "white";
    document.getElementById("toggle-wysiwyg-mode").style.background = "rgba(30, 41, 59, 0.8)";
    document.getElementById("toggle-wysiwyg-mode").style.color = "var(--text-main)";

    // Sync visual to HTML
    document.getElementById("editor-html").value = document.getElementById("editor-visual").innerHTML;
  });

  // Pages
  document.getElementById("btn-create-page").addEventListener("click", openCreatePageModal);
  document.getElementById("form-page-editor").addEventListener("submit", savePage);

  // Comments Moderation Tabs
  document.querySelectorAll(".comment-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".comment-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeCommentStatus = btn.getAttribute("data-status");
      loadComments();
    });
  });

  // Gadget Modal Submit
  document.getElementById("btn-add-gadget-modal").addEventListener("click", () => openAddGadget('sidebar'));
  document.getElementById("form-gadget").addEventListener("submit", saveGadget);

  // Theme Gallery Cards
  document.querySelectorAll(".theme-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".theme-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      const themeId = card.getAttribute("data-theme");
      updateBlogTheme(themeId);
    });
  });

  document.getElementById("theme-customizer-form").addEventListener("submit", saveThemeSettings);

  // Blog Settings & Backup Management
  const blogSettingsForm = document.getElementById("blog-settings-form");
  if (blogSettingsForm) {
    blogSettingsForm.addEventListener("submit", saveBlogSettings);
  }

  const btnExport = document.getElementById("btn-export-backup");
  if (btnExport) {
    btnExport.addEventListener("click", exportBackup);
  }

  const btnSyncFlatfile = document.getElementById("btn-sync-flatfile");
  if (btnSyncFlatfile) {
    btnSyncFlatfile.addEventListener("click", syncFlatfileStorage);
  }

  const fileImport = document.getElementById("file-import-backup");
  if (fileImport) {
    fileImport.addEventListener("change", importBackup);
  }

  const btnDeleteBlog = document.getElementById("btn-danger-delete-blog");
  if (btnDeleteBlog) {
    btnDeleteBlog.addEventListener("click", deleteCurrentBlog);
  }

  const btnMockData = document.getElementById("btn-restore-mock-data");
  if (btnMockData) {
    btnMockData.addEventListener("click", restoreMockData);
  }

  // Admin Login Form
  const formLogin = document.getElementById("form-admin-login");
  if (formLogin) {
    formLogin.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;
      const alertEl = document.getElementById("login-error-alert");
      if (alertEl) alertEl.style.display = "none";

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          safeLocalStorageSet("weblogger_admin_token", data.token);
          closeModal("modal-admin-login");
          showToast(`Logged in as ${data.username}!`);
          await checkAuthStatus();
          await handleLocationRoute(false);
        } else {
          if (alertEl) {
            alertEl.textContent = data.error || "Invalid login credentials";
            alertEl.style.display = "block";
          }
        }
      } catch (err) {
        if (alertEl) {
          alertEl.textContent = "Server connection error";
          alertEl.style.display = "block";
        }
      }
    });
  }

  // Open Change Credentials section in Settings
  const btnOpenCreds = document.getElementById("btn-open-change-credentials");
  if (btnOpenCreds) {
    btnOpenCreds.addEventListener("click", () => {
      switchView("settings");
      const el = document.getElementById("form-change-credentials");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    });
  }

  // Change Admin Credentials Form Submit
  const formCreds = document.getElementById("form-change-credentials");
  if (formCreds) {
    formCreds.addEventListener("submit", async (e) => {
      e.preventDefault();
      const current_password = document.getElementById("change-current-password").value;
      const new_username = document.getElementById("change-new-username").value;
      const new_password = document.getElementById("change-new-password").value;
      const alertEl = document.getElementById("change-credentials-alert");

      if (alertEl) alertEl.style.display = "none";

      try {
        const res = await fetchWithAuth("/api/auth/credentials", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_password, new_username, new_password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast("Admin credentials updated successfully!");
          if (alertEl) {
            alertEl.style.background = "rgba(52, 211, 153, 0.15)";
            alertEl.style.border = "1px solid rgba(52, 211, 153, 0.4)";
            alertEl.style.color = "#34d399";
            alertEl.textContent = "Credentials updated! Use your new username & password next time you log in.";
            alertEl.style.display = "block";
          }
          document.getElementById("change-current-password").value = "";
          document.getElementById("change-new-password").value = "";
          await checkAuthStatus();
        } else {
          if (alertEl) {
            alertEl.style.background = "rgba(244, 63, 94, 0.15)";
            alertEl.style.border = "1px solid rgba(244, 63, 94, 0.4)";
            alertEl.style.color = "#f43f5e";
            alertEl.textContent = data.error || "Failed to update credentials";
            alertEl.style.display = "block";
          }
        }
      } catch (err) {
        if (alertEl) {
          alertEl.style.background = "rgba(244, 63, 94, 0.15)";
          alertEl.style.border = "1px solid rgba(244, 63, 94, 0.4)";
          alertEl.style.color = "#f43f5e";
          alertEl.textContent = "Network error updating credentials";
          alertEl.style.display = "block";
        }
      }
    });
  }

  // Admin Logout Button
  const btnLogout = document.getElementById("btn-admin-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      const token = safeLocalStorageGet("weblogger_admin_token");
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: token ? { "x-admin-token": token } : {}
        });
      } catch (e) {}
      safeLocalStorageRemove("weblogger_admin_token");
      showToast("Logged out successfully");
      await checkAuthStatus();
      await handleLocationRoute(false);
    });
  }
}

// Load Blogs List
async function loadBlogsList() {
  try {
    const res = await fetch("/api/blogs");
    currentBlogs = await res.json();
    const select = document.getElementById("blog-selector");
    select.innerHTML = "";

    currentBlogs.forEach(b => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast("Failed loading blogs list", true);
  }
}

// Switch Active Blog
async function switchBlog(blogId, updateUrl = false) {
  currentBlogId = blogId;
  safeLocalStorageSet("weblogger_active_blog_id", String(blogId));
  const blogSelector = document.getElementById("blog-selector");
  if (blogSelector) blogSelector.value = blogId;

  // Pre-fill form fields from localStorage cache immediately while fetching server data
  try {
    const cachedSettingsStr = safeLocalStorageGet(`weblogger_blog_settings_${blogId}`) || safeLocalStorageGet("weblogger_settings");
    if (cachedSettingsStr) {
      const s = JSON.parse(cachedSettingsStr);
      const perPage = document.getElementById("setting-posts-per-page");
      if (perPage && s.posts_per_page) perPage.value = String(s.posts_per_page);

      const commentsEnabled = document.getElementById("setting-comments-enabled");
      if (commentsEnabled && s.comments_enabled !== undefined) {
        commentsEnabled.value = s.comments_enabled !== false ? "true" : "false";
      }

      const layoutStyle = document.getElementById("setting-layout-style");
      if (layoutStyle && s.layout_style) layoutStyle.value = s.layout_style;

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
      };
      setVal("theme-accent-color", s.accent_color);
      setVal("theme-bg-color", s.background_color);
      setVal("theme-font-select", s.font_family);
      setVal("theme-header-image", s.header_image);
    }
  } catch (e) {}

  // Fetch current blog metadata
  try {
    const res = await fetch(`/api/blogs/${blogId}`);
    currentBlogData = await res.json();

    const pill = document.getElementById("active-blog-pill");
    if (pill) pill.textContent = currentBlogData.name;

    const rss = document.getElementById("btn-rss-feed");
    if (rss) rss.href = `/${currentBlogData.slug}/feed.xml`;

    const btnPub = document.getElementById("btn-view-public-blog");
    if (btnPub) btnPub.href = `/${currentBlogData.slug}`;

    const btnPrev = document.getElementById("btn-view-preview-blog");
    if (btnPrev) btnPrev.href = `/preview-${currentBlogData.slug}`;

    const isAppAdmin = window.location.pathname.startsWith("/admin");
    if (updateUrl && currentBlogData.slug && !isAppAdmin) {
      const targetPath = "/" + currentBlogData.slug;
      if (window.location.pathname !== targetPath) {
        history.pushState({ blogId: currentBlogData.id, blogSlug: currentBlogData.slug }, "", targetPath);
      }
    }

    // Helper to safely set element value
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || "";
    };

    // Update settings form fields safely
    setVal("setting-blog-name", currentBlogData.name);
    setVal("setting-blog-slug", currentBlogData.slug);
    setVal("setting-blog-desc", currentBlogData.description);
    setVal("setting-author-name", currentBlogData.author_name);
    setVal("setting-author-avatar", currentBlogData.author_avatar);
    setVal("setting-author-bio", currentBlogData.author_bio);
    setVal("change-new-username", currentAdminUser || "admin");

    // Parse settings JSON for theme customizer and settings form
    let settings = {};
    try { settings = JSON.parse(currentBlogData.settings_json || "{}"); } catch (e) {}

    // Store loaded settings into localStorage
    safeLocalStorageSet("weblogger_settings", JSON.stringify(settings));
    safeLocalStorageSet(`weblogger_blog_settings_${blogId}`, JSON.stringify(settings));

    const perPage = document.getElementById("setting-posts-per-page");
    if (perPage) perPage.value = String(settings.posts_per_page || 5);

    const commentsEnabled = document.getElementById("setting-comments-enabled");
    if (commentsEnabled) commentsEnabled.value = settings.comments_enabled !== false ? "true" : "false";

    const layoutStyle = document.getElementById("setting-layout-style");
    if (layoutStyle) layoutStyle.value = settings.layout_style || "sidebar-right";

    setVal("theme-accent-color", settings.accent_color || "#6366f1");
    setVal("theme-bg-color", settings.background_color || "#0f172a");
    setVal("theme-font-select", settings.font_family || "Inter");
    setVal("theme-header-image", settings.header_image || "");
    setVal("theme-custom-css", currentBlogData.custom_css || "");

    // Highlight theme card
    const themeId = currentBlogData.theme_id || "contempo";
    document.querySelectorAll(".theme-card").forEach(c => {
      c.classList.toggle("active", c.getAttribute("data-theme") === themeId);
    });

    // Refresh current view data
    refreshCurrentView();
  } catch (err) {
    console.error("Error switching blog:", err);
  }
}

function toggleMobileSidebar(show) {
  const sidebar = document.querySelector(".app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;
  const isMobileOpen = sidebar.classList.contains("mobile-open");
  const shouldOpen = show !== undefined ? show : !isMobileOpen;
  
  if (shouldOpen) {
    sidebar.classList.add("mobile-open");
    if (backdrop) backdrop.classList.add("active");
  } else {
    sidebar.classList.remove("mobile-open");
    if (backdrop) backdrop.classList.remove("active");
  }
}

// Switch UI View
function switchView(viewName, updateUrl = true) {
  toggleMobileSidebar(false);
  currentView = viewName;
  safeLocalStorageSet("weblogger_active_view", viewName);
  document.querySelectorAll(".app-view").forEach(el => el.style.display = "none");

  const target = document.getElementById(`view-${viewName}`);
  if (target) target.style.display = "block";

  // Active state in sidebar
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-view") === viewName);
  });

  if (updateUrl) {
    const targetPath = `/admin/${viewName}`;
    if (window.location.pathname !== targetPath) {
      history.pushState({ view: viewName }, "", targetPath);
    }
  }

  // Page title
  const titles = {
    posts: "Posts",
    editor: "New Post Editor",
    pages: "Static Pages",
    comments: "Comments Moderation",
    stats: "Analytics & Stats",
    layout: "Blog Layout & Gadgets",
    theme: "Theme & Customizer",
    settings: "Blog Settings"
  };
  document.getElementById("page-heading").textContent = titles[viewName] || "Dashboard";

  refreshCurrentView();
}

function refreshCurrentView() {
  if (currentView === "posts") loadPosts();
  else if (currentView === "pages") loadPages();
  else if (currentView === "comments") loadComments();
  else if (currentView === "stats") loadStats();
  else if (currentView === "layout") loadGadgets();

  updateSidebarBadges();
}

// Update sidebar badge counts
async function updateSidebarBadges() {
  try {
    const postsRes = await fetch(`/api/posts?blog_id=${currentBlogId}`);
    const posts = await postsRes.json();
    document.getElementById("badge-posts-count").textContent = posts.length;

    const pagesRes = await fetch(`/api/pages?blog_id=${currentBlogId}`);
    const pages = await pagesRes.json();
    document.getElementById("badge-pages-count").textContent = pages.length;

    const commentsRes = await fetch(`/api/comments?blog_id=${currentBlogId}&status=pending`);
    const pendingComments = await commentsRes.json();
    document.getElementById("badge-comments-count").textContent = pendingComments.length;
  } catch (e) {}
}

// ----------------------------------------------------
// 1. POSTS LOGIC
// ----------------------------------------------------
async function loadPosts() {
  const search = document.getElementById("posts-search-input").value;
  const status = document.getElementById("posts-status-filter").value;

  let url = `/api/posts?blog_id=${currentBlogId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (status) url += `&status=${status}`;

  try {
    const res = await fetch(url);
    const posts = await res.json();
    const tbody = document.getElementById("posts-table-body");

    if (posts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">No posts found. Create your first post!</td></tr>`;
      return;
    }

    tbody.innerHTML = posts.map(p => {
      const labelsHtml = p.labels ? p.labels.split(',').map(l => `<span class="tag-chip">${l.trim()}</span>`).join('') : '<span class="text-slate-500 text-xs">—</span>';
      const statusBadge = p.status === 'published'
        ? `<span class="status-badge badge-published">Published</span>`
        : `<span class="status-badge badge-draft">Draft</span>`;

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: white;">${escapeHtml(p.title)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); truncate; max-width: 340px;">${escapeHtml(p.excerpt || '')}</div>
          </td>
          <td>${statusBadge}</td>
          <td>${labelsHtml}</td>
          <td>👁️ ${p.views || 0}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(p.published_at).toLocaleDateString()}</td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="editPost(${p.id})">✏️ Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deletePost(${p.id})">🗑 Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast("Error loading posts", true);
  }
}

async function editPost(postId) {
  try {
    const res = await fetch(`/api/posts/${postId}`);
    const p = await res.json();

    document.getElementById("editor-post-id").value = p.id;
    document.getElementById("editor-mode-title").textContent = "Edit Post";
    document.getElementById("editor-title-input").value = p.title;
    document.getElementById("editor-slug-input").value = p.slug;
    document.getElementById("editor-visual").innerHTML = p.content;
    document.getElementById("editor-html").value = p.content;
    document.getElementById("editor-labels-input").value = p.labels || "";
    document.getElementById("editor-cover-input").value = p.cover_image || "";

    switchView("editor");
  } catch (err) {
    showToast("Failed loading post data", true);
  }
}

function resetPostEditor() {
  document.getElementById("editor-post-id").value = "";
  document.getElementById("editor-mode-title").textContent = "Create New Post";
  document.getElementById("editor-title-input").value = "";
  document.getElementById("editor-slug-input").value = "";
  document.getElementById("editor-visual").innerHTML = "";
  document.getElementById("editor-html").value = "";
  document.getElementById("editor-labels-input").value = "";
  document.getElementById("editor-cover-input").value = "";
  safeLocalStorageRemove("weblogger_post_draft");
}

function autoSavePostDraft() {
  const title = document.getElementById("editor-title-input").value;
  const slug = document.getElementById("editor-slug-input").value;
  const isHtmlMode = document.getElementById("editor-html").style.display !== "none";
  const content = isHtmlMode ? document.getElementById("editor-html").value : document.getElementById("editor-visual").innerHTML;
  const labels = document.getElementById("editor-labels-input").value;
  const cover_image = document.getElementById("editor-cover-input").value;
  const id = document.getElementById("editor-post-id").value;

  if (title || content) {
    safeLocalStorageSet("weblogger_post_draft", JSON.stringify({ id, title, slug, content, labels, cover_image }));
  }
}

function restorePostDraft() {
  const draftStr = safeLocalStorageGet("weblogger_post_draft");
  if (!draftStr) return;
  try {
    const d = JSON.parse(draftStr);
    if (d.title || d.content) {
      document.getElementById("editor-post-id").value = d.id || "";
      document.getElementById("editor-title-input").value = d.title || "";
      document.getElementById("editor-slug-input").value = d.slug || "";
      document.getElementById("editor-visual").innerHTML = d.content || "";
      document.getElementById("editor-html").value = d.content || "";
      document.getElementById("editor-labels-input").value = d.labels || "";
      document.getElementById("editor-cover-input").value = d.cover_image || "";
    }
  } catch(e){}
}

async function savePost(targetStatus) {
  const id = document.getElementById("editor-post-id").value;
  const title = document.getElementById("editor-title-input").value.trim();
  const slug = document.getElementById("editor-slug-input").value.trim();
  const isHtmlMode = document.getElementById("editor-html").style.display !== "none";
  const content = isHtmlMode ? document.getElementById("editor-html").value : document.getElementById("editor-visual").innerHTML;
  const labels = document.getElementById("editor-labels-input").value;
  const cover_image = document.getElementById("editor-cover-input").value;

  if (!title) {
    showToast("Please enter a post title", true);
    return;
  }

  const payload = {
    blog_id: currentBlogId,
    title,
    slug,
    content,
    status: targetStatus,
    labels,
    cover_image,
    author_name: currentBlogData?.author_name || "Admin Author"
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/posts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    if (res.ok) {
      showToast(id ? "Post updated!" : (targetStatus === 'published' ? "Post published! 🚀" : "Draft saved!"));
      safeLocalStorageRemove("weblogger_post_draft");
      resetPostEditor();
      switchView("posts");
    } else {
      showToast("Error saving post", true);
    }
  } catch (err) {
    showToast("Error connecting to server", true);
  }
}

async function deletePost(id) {
  const confirmed = await customConfirm("Are you sure you want to delete this post?", "Delete Post");
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Post deleted");
      loadPosts();
      updateSidebarBadges();
    } else {
      showToast("Failed to delete post", true);
    }
  } catch (err) {
    showToast("Failed to delete post", true);
  }
}

// WYSIWYG Formatting Helpers
function execCmd(command, value = null) {
  document.execCommand(command, false, value);
  document.getElementById("editor-visual").focus();
}

async function promptLink() {
  const url = await customPrompt("Enter URL to insert:", "https://", "Insert Link", "https://example.com");
  if (url) execCmd("createLink", url);
}

async function promptImage() {
  const url = await customPrompt("Enter Image URL to insert:", "https://images.unsplash.com/...", "Insert Image", "https://...");
  if (url) execCmd("insertImage", url);
}

// ----------------------------------------------------
// 2. PAGES LOGIC
// ----------------------------------------------------
async function loadPages() {
  try {
    const res = await fetch(`/api/pages?blog_id=${currentBlogId}`);
    const pages = await res.json();
    const tbody = document.getElementById("pages-table-body");

    if (pages.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No static pages created yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = pages.map(p => `
      <tr>
        <td style="font-weight: 700; color: white;">${escapeHtml(p.title)}</td>
        <td><code>/page/${escapeHtml(p.slug)}</code></td>
        <td style="max-width: 280px; font-size: 0.8rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(p.meta_description || '')}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(p.created_at).toLocaleDateString()}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button class="btn btn-secondary btn-sm" onclick="editPage(${p.id})">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deletePage(${p.id})">🗑 Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast("Error loading pages", true);
  }
}

function openCreatePageModal() {
  document.getElementById("page-editor-id").value = "";
  document.getElementById("page-editor-modal-title").textContent = "Create New Static Page";
  document.getElementById("page-editor-title").value = "";
  document.getElementById("page-editor-slug").value = "";
  document.getElementById("page-editor-content").value = "";
  document.getElementById("page-editor-meta-desc").value = "";
  openModal("modal-page-editor");
}

async function editPage(id) {
  try {
    const res = await fetch(`/api/pages/${id}`);
    const p = await res.json();

    document.getElementById("page-editor-id").value = p.id;
    document.getElementById("page-editor-modal-title").textContent = "Edit Static Page";
    document.getElementById("page-editor-title").value = p.title || "";
    document.getElementById("page-editor-slug").value = p.slug || "";
    document.getElementById("page-editor-content").value = p.content || "";
    document.getElementById("page-editor-meta-desc").value = p.meta_description || "";

    openModal("modal-page-editor");
  } catch (err) {
    showToast("Failed to load page data", true);
  }
}

async function savePage(e) {
  e.preventDefault();
  const id = document.getElementById("page-editor-id").value;
  const title = document.getElementById("page-editor-title").value.trim();
  const slug = document.getElementById("page-editor-slug").value.trim();
  const content = document.getElementById("page-editor-content").value;
  const meta_description = document.getElementById("page-editor-meta-desc").value;

  if (!title || !content) {
    showToast("Page title and content are required", true);
    return;
  }

  const payload = {
    blog_id: currentBlogId,
    title,
    slug,
    content,
    meta_description
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/pages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    if (res.ok) {
      showToast(id ? "Page updated!" : "Page created!");
      closeModal("modal-page-editor");
      loadPages();
      updateSidebarBadges();
    } else {
      showToast("Error saving page", true);
    }
  } catch (err) {
    showToast("Error connecting to server", true);
  }
}

async function deletePage(id) {
  const confirmed = await customConfirm("Delete this static page?", "Delete Page");
  if (!confirmed) return;
  try {
    await fetch(`/api/pages/${id}`, { method: "DELETE" });
    showToast("Page deleted");
    loadPages();
    updateSidebarBadges();
  } catch (err) {
    showToast("Error deleting page", true);
  }
}

// ----------------------------------------------------
// 3. COMMENTS LOGIC
// ----------------------------------------------------
async function loadComments() {
  try {
    const res = await fetch(`/api/comments?blog_id=${currentBlogId}&status=${activeCommentStatus}`);
    const comments = await res.json();
    const tbody = document.getElementById("comments-table-body");

    if (comments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">No comments in ${activeCommentStatus}.</td></tr>`;
      return;
    }

    tbody.innerHTML = comments.map(c => `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="${c.author_avatar}" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-color);">
            <div>
              <div style="font-weight: 700; color: white; font-size: 0.88rem;">${escapeHtml(c.author_name)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(c.author_email || '')}</div>
            </div>
          </div>
        </td>
        <td style="max-width: 320px; font-size: 0.88rem; color: #e2e8f0;">${escapeHtml(c.content)}</td>
        <td style="font-size: 0.8rem; color: var(--accent-color); font-weight: 600;">${escapeHtml(c.post_title || 'Post')}</td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${new Date(c.created_at).toLocaleDateString()}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            ${c.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="updateCommentStatus(${c.id}, 'approved')">Approve</button>` : ''}
            ${c.status !== 'spam' ? `<button class="btn btn-secondary btn-sm" onclick="updateCommentStatus(${c.id}, 'spam')">Spam</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteComment(${c.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast("Error loading comments", true);
  }
}

async function updateCommentStatus(id, newStatus) {
  try {
    await fetch(`/api/comments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Comment marked as ${newStatus}`);
    loadComments();
    updateSidebarBadges();
  } catch (err) {
    showToast("Error updating comment", true);
  }
}

async function deleteComment(id) {
  const confirmed = await customConfirm("Delete comment permanently?", "Delete Comment");
  if (!confirmed) return;
  try {
    await fetch(`/api/comments/${id}`, { method: "DELETE" });
    showToast("Comment deleted");
    loadComments();
    updateSidebarBadges();
  } catch (err) {
    showToast("Error deleting comment", true);
  }
}

// ----------------------------------------------------
// 4. STATS LOGIC
// ----------------------------------------------------
async function loadStats() {
  try {
    const res = await fetch(`/api/stats?blog_id=${currentBlogId}`);
    const data = await res.json();

    document.getElementById("stat-total-views").textContent = (data.total_views || 0).toLocaleString();
    document.getElementById("stat-total-posts").textContent = (data.total_posts || 0).toLocaleString();
    document.getElementById("stat-total-comments").textContent = (data.total_comments || 0).toLocaleString();

    // Top posts
    const topPostsContainer = document.getElementById("top-posts-list");
    if (!data.top_posts || data.top_posts.length === 0) {
      topPostsContainer.innerHTML = `<p class="text-sm text-slate-400">No view data recorded yet.</p>`;
    } else {
      topPostsContainer.innerHTML = data.top_posts.map(p => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
          <span style="font-weight: 600; font-size: 0.9rem; color: white;">${escapeHtml(p.title)}</span>
          <span class="active-blog-badge">👁️ ${p.views} views</span>
        </div>
      `).join('');
    }

    // Referrers
    const referrersContainer = document.getElementById("referrers-list");
    if (!data.referrers || data.referrers.length === 0) {
      referrersContainer.innerHTML = `<p class="text-sm text-slate-400">No referral traffic logged yet.</p>`;
    } else {
      referrersContainer.innerHTML = data.referrers.map(r => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
          <span style="font-size: 0.88rem; color: var(--text-main);">${escapeHtml(r.referrer)}</span>
          <span style="font-weight: 700; color: #818cf8; font-size: 0.88rem;">${r.count} visits</span>
        </div>
      `).join('');
    }
  } catch (err) {
    showToast("Error loading stats", true);
  }
}

// ----------------------------------------------------
// 5. GADGETS & LAYOUT LOGIC
// ----------------------------------------------------
let loadedGadgetsList = [];

async function loadGadgets() {
  try {
    const res = await fetch(`/api/gadgets?blog_id=${currentBlogId}`);
    const gadgets = await res.json();
    loadedGadgetsList = Array.isArray(gadgets) ? gadgets : [];

    const headerZone = document.getElementById("gadgets-header-zone");
    const sidebarZone = document.getElementById("gadgets-sidebar-zone");
    const footerZone = document.getElementById("gadgets-footer-zone");

    headerZone.innerHTML = "";
    sidebarZone.innerHTML = "";
    footerZone.innerHTML = "";

    loadedGadgetsList.forEach(g => {
      const cardHtml = `
        <div class="gadget-card" data-id="${g.id}">
          <div>
            <div class="gadget-title">${escapeHtml(g.title)}</div>
            <div class="gadget-type-tag">Type: ${g.type}</div>
          </div>
          <div class="gadget-actions">
            <button class="btn btn-secondary btn-sm" onclick="toggleGadget(${g.id}, ${g.is_enabled ? 0 : 1})">${g.is_enabled ? 'Active' : 'Disabled'}</button>
            <button class="btn btn-secondary btn-sm" onclick="openEditGadget(${g.id})">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteGadget(${g.id})">✕</button>
          </div>
        </div>
      `;

      if (g.section === 'header') headerZone.innerHTML += cardHtml;
      else if (g.section === 'footer') footerZone.innerHTML += cardHtml;
      else sidebarZone.innerHTML += cardHtml;
    });
  } catch (err) {
    showToast("Error loading layout gadgets", true);
  }
}

function openAddGadget(section = 'sidebar') {
  const titleEl = document.getElementById("gadget-modal-title");
  if (titleEl) titleEl.textContent = "Add Gadget Widget";

  const editIdEl = document.getElementById("gadget-edit-id");
  if (editIdEl) editIdEl.value = "";

  document.getElementById("gadget-target-section").value = section;
  const sectionSelect = document.getElementById("gadget-section-select");
  if (sectionSelect) sectionSelect.value = section;

  document.getElementById("gadget-type-select").value = "text";
  document.getElementById("gadget-title-input").value = "";
  document.getElementById("gadget-content-input").value = "";
  openModal("modal-gadget");
}

function openEditGadget(id) {
  const g = loadedGadgetsList.find(item => item.id === id);
  if (!g) return;

  const titleEl = document.getElementById("gadget-modal-title");
  if (titleEl) titleEl.textContent = "Edit Gadget Widget";

  const editIdEl = document.getElementById("gadget-edit-id");
  if (editIdEl) editIdEl.value = g.id;

  document.getElementById("gadget-target-section").value = g.section || "sidebar";
  const sectionSelect = document.getElementById("gadget-section-select");
  if (sectionSelect) sectionSelect.value = g.section || "sidebar";

  document.getElementById("gadget-type-select").value = g.type || "text";
  document.getElementById("gadget-title-input").value = g.title || "";

  let content = "";
  try {
    const config = JSON.parse(g.config_json || '{}');
    content = config.content !== undefined ? config.content : (g.config_json || '');
  } catch (e) {
    content = g.config_json || "";
  }
  document.getElementById("gadget-content-input").value = content;
  openModal("modal-gadget");
}

async function saveGadget(e) {
  e.preventDefault();
  const editIdEl = document.getElementById("gadget-edit-id");
  const editId = editIdEl ? editIdEl.value : "";

  const sectionSelect = document.getElementById("gadget-section-select");
  const section = sectionSelect ? sectionSelect.value : document.getElementById("gadget-target-section").value;
  const type = document.getElementById("gadget-type-select").value;
  const title = document.getElementById("gadget-title-input").value;
  const content = document.getElementById("gadget-content-input").value;
  const config_json = JSON.stringify({ content });

  try {
    if (editId) {
      await fetch(`/api/gadgets/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type,
          section,
          config_json
        })
      });
      showToast("Gadget updated!");
    } else {
      await fetch("/api/gadgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blog_id: currentBlogId,
          type,
          title,
          section,
          config_json
        })
      });
      showToast("Gadget added to layout!");
    }
    closeModal("modal-gadget");
    loadGadgets();
  } catch (err) {
    showToast(editId ? "Error updating gadget" : "Error adding gadget", true);
  }
}

async function toggleGadget(id, newEnabled) {
  try {
    await fetch(`/api/gadgets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: newEnabled })
    });
    loadGadgets();
  } catch (err) {}
}

async function deleteGadget(id) {
  const confirmed = await customConfirm("Remove this gadget from layout?", "Remove Gadget");
  if (!confirmed) return;
  try {
    await fetch(`/api/gadgets/${id}`, { method: "DELETE" });
    showToast("Gadget removed");
    loadGadgets();
  } catch (err) {
    showToast("Error removing gadget", true);
  }
}

// ----------------------------------------------------
// 6. THEME CUSTOMIZER LOGIC
// ----------------------------------------------------
const THEME_PRESETS = {
  contempo: {
    name: "Contempo Dark",
    accent_color: "#6366f1",
    background_color: "#0f172a",
    font_family: "Inter",
    card_bg: "rgba(30, 41, 59, 0.7)",
    card_border: "rgba(255, 255, 255, 0.08)",
    title_color: "#ffffff",
    content_color: "#e2e8f0",
    header_image: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80"
  },
  dracula: {
    name: "Dracula Gothic",
    accent_color: "#bd93f9",
    background_color: "#282a36",
    font_family: "Fira Code",
    card_bg: "#44475a",
    card_border: "rgba(189, 147, 249, 0.3)",
    title_color: "#f8f8f2",
    content_color: "#f8f8f2",
    header_image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80"
  },
  cyberpunk: {
    name: "Cyberpunk Neon",
    accent_color: "#00f0ff",
    background_color: "#090a0f",
    font_family: "Plus Jakarta Sans",
    card_bg: "rgba(18, 26, 43, 0.85)",
    card_border: "rgba(0, 240, 255, 0.35)",
    title_color: "#ffffff",
    content_color: "#e0f7fc",
    header_image: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80"
  },
  nord: {
    name: "Nordic Frost",
    accent_color: "#88c0d0",
    background_color: "#2e3440",
    font_family: "Inter",
    card_bg: "#3b4252",
    card_border: "rgba(136, 192, 208, 0.25)",
    title_color: "#eceff4",
    content_color: "#d8dee9",
    header_image: "https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=1200&q=80"
  },
  solarized: {
    name: "Solarized Amber",
    accent_color: "#b58900",
    background_color: "#002b36",
    font_family: "Inter",
    card_bg: "#073642",
    card_border: "rgba(181, 137, 0, 0.3)",
    title_color: "#93a1a1",
    content_color: "#839496",
    header_image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80"
  },
  soho: {
    name: "Soho Slate",
    accent_color: "#059669",
    background_color: "#0f172a",
    font_family: "Plus Jakarta Sans",
    card_bg: "rgba(30, 41, 59, 0.7)",
    card_border: "rgba(5, 150, 105, 0.3)",
    title_color: "#ffffff",
    content_color: "#e2e8f0",
    header_image: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=80"
  },
  essential: {
    name: "Essential Code",
    accent_color: "#38bdf8",
    background_color: "#090d16",
    font_family: "Fira Code",
    card_bg: "#1e293b",
    card_border: "rgba(56, 189, 248, 0.25)",
    title_color: "#f8fafc",
    content_color: "#cbd5e1",
    header_image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80"
  },
  emporium: {
    name: "Emporium Light",
    accent_color: "#0284c7",
    background_color: "#f8fafc",
    font_family: "Plus Jakarta Sans",
    card_bg: "#ffffff",
    card_border: "rgba(226, 232, 240, 0.9)",
    title_color: "#0f172a",
    content_color: "#334155",
    header_image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80"
  }
};

async function updateBlogTheme(themeId) {
  const preset = THEME_PRESETS[themeId] || THEME_PRESETS.contempo;

  let settings = {};
  try { settings = JSON.parse(currentBlogData.settings_json || "{}"); } catch(e){}

  const updatedSettings = {
    ...settings,
    accent_color: preset.accent_color,
    background_color: preset.background_color,
    font_family: preset.font_family,
    header_image: preset.header_image,
    card_bg: preset.card_bg,
    card_border: preset.card_border,
    title_color: preset.title_color,
    content_color: preset.content_color
  };

  try {
    const res = await fetchWithAuth(`/api/blogs/${currentBlogId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme_id: themeId,
        settings_json: JSON.stringify(updatedSettings)
      })
    });
    if (res.ok) {
      const updatedBlog = await res.json();
      currentBlogData = updatedBlog;
      safeLocalStorageSet("weblogger_settings", JSON.stringify(updatedSettings));
      safeLocalStorageSet(`weblogger_blog_settings_${currentBlogId}`, JSON.stringify(updatedSettings));
      showToast(`Theme updated to ${preset.name}! ✨`);
      await switchBlog(currentBlogId);
    } else {
      showToast("Failed to update theme", true);
    }
  } catch (err) {
    showToast("Failed to update theme", true);
  }
}

async function saveThemeSettings(e) {
  e.preventDefault();
  const accent_color = document.getElementById("theme-accent-color").value;
  const background_color = document.getElementById("theme-bg-color").value;
  const font_family = document.getElementById("theme-font-select").value;
  const header_image = document.getElementById("theme-header-image").value;
  const custom_css = document.getElementById("theme-custom-css").value;

  let existingSettings = {};
  try { existingSettings = JSON.parse(currentBlogData.settings_json || "{}"); } catch(e){}

  const newSettings = {
    ...existingSettings,
    accent_color,
    background_color,
    font_family,
    header_image
  };

  try {
    const res = await fetchWithAuth(`/api/blogs/${currentBlogId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings_json: JSON.stringify(newSettings),
        custom_css
      })
    });
    if (res.ok) {
      const updatedBlog = await res.json();
      currentBlogData = updatedBlog;
      safeLocalStorageSet("weblogger_settings", JSON.stringify(newSettings));
      safeLocalStorageSet(`weblogger_blog_settings_${currentBlogId}`, JSON.stringify(newSettings));
      showToast("Theme customizer settings saved!");
      await switchBlog(currentBlogId);
    } else {
      showToast("Error saving theme settings", true);
    }
  } catch (err) {
    showToast("Error saving theme settings", true);
  }
}

// ----------------------------------------------------
// 7. SETTINGS & BACKUP LOGIC
// ----------------------------------------------------
async function saveBlogSettings(e) {
  e.preventDefault();
  const name = document.getElementById("setting-blog-name").value.trim();
  const slug = document.getElementById("setting-blog-slug").value.trim();
  const description = document.getElementById("setting-blog-desc").value;
  const author_name = document.getElementById("setting-author-name").value;
  const author_avatar = document.getElementById("setting-author-avatar").value;
  const author_bio = document.getElementById("setting-author-bio").value;

  const posts_per_page = Number(document.getElementById("setting-posts-per-page")?.value || 5);
  const comments_enabled = document.getElementById("setting-comments-enabled")?.value === "true";
  const layout_style = document.getElementById("setting-layout-style")?.value || "sidebar-right";

  let existingSettings = {};
  try { existingSettings = JSON.parse(currentBlogData.settings_json || "{}"); } catch(e){}

  const updatedSettings = {
    ...existingSettings,
    posts_per_page,
    comments_enabled,
    layout_style
  };

  try {
    const res = await fetchWithAuth(`/api/blogs/${currentBlogId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        description,
        author_name,
        author_avatar,
        author_bio,
        settings_json: JSON.stringify(updatedSettings)
      })
    });

    if (res.ok) {
      const updatedBlog = await res.json();
      currentBlogData = updatedBlog;
      safeLocalStorageSet("weblogger_settings", JSON.stringify(updatedSettings));
      safeLocalStorageSet(`weblogger_blog_settings_${updatedBlog.id}`, JSON.stringify(updatedSettings));
      showToast("Blog settings updated successfully! ⚙️");
      await loadBlogsList();
      await switchBlog(updatedBlog.id, false);
    } else {
      showToast("Failed to save blog settings", true);
    }
  } catch (err) {
    showToast("Error updating settings", true);
  }
}

async function exportBackup() {
  try {
    const res = await fetch(`/api/export?blog_id=${currentBlogId}`);
    if (!res.ok) {
      showToast("Export failed: " + res.statusText, true);
      return;
    }
    const data = await res.json();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.download = `weblogger_backup_${data.blog?.slug || 'blog'}_${Date.now()}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
    showToast("Backup exported successfully!");
  } catch (err) {
    showToast("Export failed", true);
  }
}

async function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const backupData = JSON.parse(event.target.result);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backupData)
      });
      const result = await res.json();
      if (res.ok && result.success) {
        showToast("Backup imported as new blog!");
        await loadBlogsList();
        switchBlog(result.new_blog_id);
      } else {
        showToast(result.error || "Import failed", true);
      }
    } catch (err) {
      showToast("Invalid JSON backup file", true);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

async function restoreMockData() {
  const confirmed = await customConfirm(
    "Are you sure you want to restore the default mock data? All custom posts, comments, pages, and layout edits will be reset to default sample mock data.",
    "Restore Mock Data"
  );
  if (!confirmed) {
    showToast("Mock data restoration cancelled");
    return;
  }
  try {
    const res = await fetch("/api/mock-data", { method: "POST" });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast("Mock data restored successfully! 🔄");
      await loadBlogsList();
      if (currentBlogs.length > 0) {
        await switchBlog(currentBlogs[0].id);
      }
    } else {
      showToast(data.error || "Failed to restore mock data", true);
    }
  } catch (err) {
    showToast("Error restoring mock data", true);
  }
}

async function syncFlatfileStorage() {
  try {
    const res = await fetchWithAuth("/api/flatfile/sync", { method: "POST" });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast("Settings & blogs saved to Flatfile Storage! 💾");
    } else {
      showToast(data.error || "Flatfile storage save failed", true);
    }
  } catch (e) {
    showToast("Error saving to Flatfile Storage", true);
  }
}

const reseedDatabase = restoreMockData;

async function deleteCurrentBlog() {
  if (currentBlogs.length <= 1) {
    showToast("Cannot delete the only remaining blog", true);
    return;
  }
  const confirmed = await customConfirm(`Are you sure you want to PERMANENTLY DELETE blog "${currentBlogData.name}"?`, "Delete Blog");
  if (!confirmed) return;

  try {
    await fetch(`/api/blogs/${currentBlogId}`, { method: "DELETE" });
    showToast("Blog deleted");
    await loadBlogsList();
    switchBlog(currentBlogs[0].id);
  } catch (err) {
    showToast("Delete failed", true);
  }
}

// ----------------------------------------------------
// 8. PUBLIC BLOG READER INTERACTIVE PREVIEW
// ----------------------------------------------------
async function openPublicBlogReader(isPreview = false, singlePostId = null) {
  openModal("modal-public-blog");
  const previewHeader = document.getElementById("public-blog-preview-header");
  if (previewHeader) {
    previewHeader.style.display = isPreview ? "flex" : "none";
  }
  if (currentBlogData) {
    const titleEl = document.getElementById("public-blog-preview-title");
    if (titleEl) titleEl.textContent = currentBlogData.name;
  }
  await renderPublicBlogView(singlePostId, isPreview);
}

async function renderPublicBlogView(singlePostId = null, isPreview = false) {
  const container = document.getElementById("public-blog-container");
  container.innerHTML = `<div style="text-align:center; padding: 60px; color: var(--text-muted);">Loading public blog...</div>`;

  let settings = {};
  try { settings = JSON.parse(currentBlogData.settings_json || "{}"); } catch(e){}

  const themeId = currentBlogData.theme_id || "contempo";
  const preset = THEME_PRESETS[themeId] || THEME_PRESETS.contempo;

  const accentColor = settings.accent_color || preset.accent_color;
  const bgColor = settings.background_color || preset.background_color;
  const fontFamily = settings.font_family || preset.font_family;
  const cardBg = settings.card_bg || preset.card_bg;
  const cardBorder = settings.card_border || preset.card_border;
  const titleColor = settings.title_color || preset.title_color;
  const contentColor = settings.content_color || preset.content_color;
  const headerImg = (settings.header_image || preset.header_image) ? `url('${settings.header_image || preset.header_image}')` : 'none';

  const pathPrefix = isPreview ? `/preview-${currentBlogData.slug}` : `/${currentBlogData.slug}`;

  // Apply custom design variables to reader container
  container.style.setProperty("--pub-accent", accentColor);
  container.style.setProperty("--pub-bg", bgColor);
  container.style.setProperty("--pub-font", fontFamily);
  container.style.setProperty("--pub-card-bg", cardBg);
  container.style.setProperty("--pub-card-border", cardBorder);
  container.style.setProperty("--pub-title-color", titleColor);
  container.style.setProperty("--pub-content-color", contentColor);

  // Fetch posts and gadgets
  const postsRes = await fetch(`/api/posts?blog_id=${currentBlogId}&status=published`);
  const posts = await postsRes.json();

  const gadgetsRes = await fetch(`/api/gadgets?blog_id=${currentBlogId}`);
  const gadgets = await gadgetsRes.json();

  const activeGadgets = gadgets.filter(g => g.is_enabled);

  // Render Header
  let html = `
    <header class="pub-header" style="background-image: ${headerImg};">
      <div class="pub-header-overlay">
        <h1 class="pub-blog-title">${escapeHtml(currentBlogData.name)}</h1>
        <p class="pub-blog-desc">${escapeHtml(currentBlogData.description || '')}</p>
      </div>
    </header>
    <nav class="pub-nav" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; gap: 16px; align-items: center;">
        <a href="${pathPrefix}" onclick="history.pushState({}, '', '${pathPrefix}'); handleLocationRoute(false); return false;" class="pub-nav-item">Home</a>
        <a href="#" onclick="customAlert('Static page rendering is active in reader view.', 'About Blog'); return false;" class="pub-nav-item">About</a>
        <a href="/feed.xml?blog_id=${currentBlogId}" target="_blank" class="pub-nav-item">RSS Feed</a>
      </div>
      ${currentAdminUser ? `
        <div style="display: flex; gap: 12px; align-items: center;">
          ${isPreview ? `
            <a href="/${currentBlogData.slug}" target="_blank" class="pub-nav-item" style="color: #34d399; font-weight: 600;">🌐 View Public Page ↗</a>
          ` : `
            <a href="/preview-${currentBlogData.slug}" target="_blank" class="pub-nav-item" style="color: #a5b4fc; font-weight: 600;">👁️ Switch to Preview Mode ↗</a>
          `}
          <a href="/admin" onclick="closeModal('modal-public-blog'); history.pushState({}, '', '/admin'); handleLocationRoute(false); return false;" class="pub-nav-item" style="color: #38bdf8; font-weight: 600;">⚙️ CMS Admin</a>
        </div>
      ` : ''}
    </nav>
    <div class="pub-container">
      <main class="pub-main-posts">
  `;

  // Render Single Post or Posts Feed
  if (singlePostId) {
    const postRes = await fetch(`/api/posts/${singlePostId}`);
    const post = await postRes.json();

    const commentsRes = await fetch(`/api/comments?post_id=${singlePostId}&status=approved`);
    const comments = await commentsRes.json();

    html += `
      <article class="pub-post-card">
        ${post.cover_image ? `<img src="${post.cover_image}" class="pub-post-cover">` : ''}
        <div class="pub-post-body">
          <h2 class="pub-post-title">${escapeHtml(post.title)}</h2>
          <div class="pub-post-meta">
            <span>By ${escapeHtml(post.author_name || 'Author')}</span>
            <span>• ${new Date(post.published_at).toLocaleDateString()}</span>
            <span>• 👁️ ${post.views || 0} views</span>
          </div>
          <div class="pub-post-content">${post.content}</div>
        </div>
      </article>

      <!-- Comments Section -->
      <section style="margin-top: 32px; background: rgba(30, 41, 59, 0.5); padding: 24px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.08);">
        <h3 style="font-size: 1.2rem; font-weight: 700; color: white; margin-bottom: 20px;">💬 Reader Comments (${comments.length})</h3>

        <div style="margin-bottom: 24px;">
          ${comments.map(c => `
            <div style="display: flex; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <img src="${c.author_avatar}" style="width: 36px; height: 36px; border-radius: 50%;">
              <div>
                <div style="font-weight: 700; color: white; font-size: 0.9rem;">${escapeHtml(c.author_name)} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">• ${new Date(c.created_at).toLocaleDateString()}</span></div>
                <div style="font-size: 0.9rem; color: #cbd5e1; margin-top: 4px;">${escapeHtml(c.content)}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Add Comment Form -->
        <h4 style="font-size: 1rem; font-weight: 700; color: white; margin-bottom: 12px;">Leave a Comment</h4>
        <form onsubmit="submitReaderComment(event, ${post.id})">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <input type="text" id="reader-name" placeholder="Your Name" class="form-input" required>
            <input type="email" id="reader-email" placeholder="Your Email" class="form-input">
          </div>
          <textarea id="reader-content" placeholder="Write your comment..." class="form-textarea" rows="3" required></textarea>
          <button type="submit" class="btn btn-primary" style="margin-top: 12px;">Post Comment</button>
        </form>
      </section>
    `;
  } else {
    // List of Posts
    if (posts.length === 0) {
      html += `<p style="color: var(--text-muted);">No published posts available.</p>`;
    } else {
      posts.forEach(p => {
        html += `
          <article class="pub-post-card">
            ${p.cover_image ? `<img src="${p.cover_image}" class="pub-post-cover">` : ''}
            <div class="pub-post-body">
              <h2 class="pub-post-title">
                <a href="${pathPrefix}/post/${p.slug}" onclick="history.pushState({}, '', '${pathPrefix}/post/${p.slug}'); handleLocationRoute(false); return false;" style="color: white; text-decoration: none;">${escapeHtml(p.title)}</a>
              </h2>
              <div class="pub-post-meta">
                <span>By ${escapeHtml(p.author_name || 'Author')}</span>
                <span>• ${new Date(p.published_at).toLocaleDateString()}</span>
                <span>• 💬 ${p.comment_count || 0} comments</span>
              </div>
              <div class="pub-post-content">${escapeHtml(p.excerpt || '')}</div>
              <button class="btn btn-secondary btn-sm" style="margin-top: 16px;" onclick="history.pushState({}, '', '${pathPrefix}/post/${p.slug}'); handleLocationRoute(false);">Read Full Story →</button>
            </div>
          </article>
        `;
      });
    }
  }

  html += `</main><aside class="pub-sidebar">`;

  // Filter active gadgets by section
  const sidebarGadgets = activeGadgets.filter(g => g.section === 'sidebar' || (!g.section && g.section !== 'footer' && g.section !== 'header'));
  const footerGadgets = activeGadgets.filter(g => g.section === 'footer');
  const headerGadgets = activeGadgets.filter(g => g.section === 'header');

  function renderGadgetBox(g) {
    let gadgetBody = '';
    let config = {};
    try { config = JSON.parse(g.config_json || '{}'); } catch(e){}

    if (g.type === 'profile') {
      gadgetBody = `
        <div style="text-align: center;">
          <img src="${currentBlogData.author_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'}" style="width: 72px; height: 72px; border-radius: 50%; border: 2px solid ${accentColor}; margin-bottom: 10px;">
          <div style="font-weight: 700; color: white;">${escapeHtml(currentBlogData.author_name || 'Alex Mercer')}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${escapeHtml(currentBlogData.author_bio || '')}</div>
        </div>
      `;
    } else if (g.type === 'search') {
      gadgetBody = `
        <input type="text" placeholder="Search blog..." class="form-input" onkeyup="if(event.key==='Enter') customAlert('Searching for: ' + this.value, 'Blog Search')">
      `;
    } else if (g.type === 'popular_posts') {
      gadgetBody = posts.slice(0, 4).map(p => `
        <div style="margin-bottom: 10px;">
          <a href="#" onclick="renderPublicBlogView(${p.id}); return false;" style="font-weight: 600; font-size: 0.85rem; color: white; text-decoration: none;">${escapeHtml(p.title)}</a>
        </div>
      `).join('');
    } else if (g.type === 'labels') {
      const allLabels = new Set();
      posts.forEach(p => { if (p.labels) p.labels.split(',').forEach(l => allLabels.add(l.trim())); });
      gadgetBody = Array.from(allLabels).map(l => `<span class="tag-chip">${escapeHtml(l)}</span>`).join('');
    } else if (g.type === 'archive') {
      gadgetBody = `
        <ul style="list-style: none; padding-left: 0; font-size: 0.85rem; color: #cbd5e1;">
          <li style="margin-bottom: 6px;">📅 <strong>2026</strong> (${posts.length} posts)</li>
        </ul>
      `;
    } else if (g.type === 'html' || g.type === 'text') {
      gadgetBody = config.content || '';
    } else {
      gadgetBody = config.content ? config.content : `<p style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(g.title)} widget content.</p>`;
    }

    return `
      <div class="pub-gadget-box">
        <h3 class="pub-gadget-title">${escapeHtml(g.title)}</h3>
        <div>${gadgetBody}</div>
      </div>
    `;
  }

  // Render Sidebar Gadgets
  sidebarGadgets.forEach(g => {
    html += renderGadgetBox(g);
  });

  html += `</aside></div>`;

  // Render Footer Gadgets
  if (footerGadgets.length > 0) {
    html += `<footer class="pub-footer-widgets" style="margin-top: 40px; padding: 24px 0; border-top: 1px solid rgba(255,255,255,0.08); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px;">`;
    footerGadgets.forEach(g => {
      html += renderGadgetBox(g);
    });
    html += `</footer>`;
  }

  container.innerHTML = html;
}

async function submitReaderComment(e, postId) {
  e.preventDefault();
  const author_name = document.getElementById("reader-name").value;
  const author_email = document.getElementById("reader-email").value;
  const content = document.getElementById("reader-content").value;

  try {
    await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId, author_name, author_email, content })
    });
    showToast("Comment submitted!");
    renderPublicBlogView(postId);
  } catch (err) {
    showToast("Failed to submit comment", true);
  }
}

// ----------------------------------------------------
// UTILITY & HTML5 DIALOG SYSTEM
// ----------------------------------------------------
function openModal(id) {
  const dialog = document.getElementById(id);
  if (dialog && typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else if (dialog) {
    dialog.classList.add("active");
  }
}

function closeModal(id) {
  const dialog = document.getElementById(id);
  if (dialog && typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
  } else if (dialog) {
    dialog.classList.remove("active");
  }
}

function customAlert(message, title = "Notification") {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialog-alert");
    document.getElementById("dialog-alert-title").textContent = title;
    document.getElementById("dialog-alert-message").textContent = message;

    const okBtn = document.getElementById("dialog-alert-ok");
    const onOk = () => {
      closeModal("dialog-alert");
      okBtn.removeEventListener("click", onOk);
      resolve();
    };

    okBtn.addEventListener("click", onOk);
    openModal("dialog-alert");
  });
}

function customConfirm(message, title = "Confirm Action") {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialog-confirm");
    document.getElementById("dialog-confirm-title").textContent = title;
    document.getElementById("dialog-confirm-message").textContent = message;

    const yesBtn = document.getElementById("dialog-confirm-yes");
    const noBtn = document.getElementById("dialog-confirm-no");

    const onYes = () => {
      closeModal("dialog-confirm");
      cleanup();
      resolve(true);
    };

    const onNo = () => {
      closeModal("dialog-confirm");
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
    };

    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
    openModal("dialog-confirm");
  });
}

function customPrompt(message, defaultValue = "", title = "Input Required", placeholder = "") {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialog-prompt");
    document.getElementById("dialog-prompt-title").textContent = title;
    document.getElementById("dialog-prompt-message").textContent = message;
    const input = document.getElementById("dialog-prompt-input");
    input.value = defaultValue;
    if (placeholder) input.placeholder = placeholder;

    const form = document.getElementById("dialog-prompt-form");
    const cancelBtn = document.getElementById("dialog-prompt-cancel");

    const onSubmit = (e) => {
      e.preventDefault();
      const val = input.value;
      closeModal("dialog-prompt");
      cleanup();
      resolve(val);
    };

    const onCancel = () => {
      closeModal("dialog-prompt");
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
    };

    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);

    openModal("dialog-prompt");
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

function showToast(message, isError = false) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  if (isError) toast.style.borderLeftColor = "#ef4444";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
