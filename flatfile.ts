import path from "path";

const isTest = process.env.NODE_ENV === "test";
export const FLATFILE_PATH = isTest 
  ? path.join(process.cwd(), "test_settings_flatfile.json")
  : path.join(process.cwd(), "settings_flatfile.json");

export interface FlatfileSettingsStore {
  updated_at: string;
  blogs: Record<string, {
    blog_id: number;
    slug: string;
    name: string;
    settings: Record<string, any>;
    custom_css?: string;
    theme_id?: string;
    updated_at: string;
  }>;
}

/**
 * Reads flatfile storage from disk safely using Bun.file
 */
export async function readFlatfileStorage(): Promise<FlatfileSettingsStore> {
  try {
    const file = Bun.file(FLATFILE_PATH);
    if (await file.exists()) {
      const content = await file.text();
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn("[Flatfile Storage] Error reading flatfile:", e);
  }
  return {
    updated_at: new Date().toISOString(),
    blogs: {}
  };
}

/**
 * Saves specific blog settings and metadata to flatfile storage on disk using Bun.write
 */
export async function saveBlogToFlatfile(blogData: {
  id: number;
  slug: string;
  name: string;
  theme_id?: string;
  custom_css?: string;
  settings_json?: string | object;
}): Promise<FlatfileSettingsStore> {
  const store = await readFlatfileStorage();
  
  let settingsObj: Record<string, any> = {};
  if (typeof blogData.settings_json === "string") {
    try {
      settingsObj = JSON.parse(blogData.settings_json || "{}");
    } catch (e) {
      settingsObj = {};
    }
  } else if (blogData.settings_json && typeof blogData.settings_json === "object") {
    settingsObj = blogData.settings_json as Record<string, any>;
  }

  const key = String(blogData.id);
  store.blogs[key] = {
    blog_id: blogData.id,
    slug: blogData.slug,
    name: blogData.name,
    theme_id: blogData.theme_id || "contempo",
    custom_css: blogData.custom_css || "",
    settings: settingsObj,
    updated_at: new Date().toISOString()
  };

  store.updated_at = new Date().toISOString();

  await Bun.write(FLATFILE_PATH, JSON.stringify(store, null, 2));
  return store;
}

/**
 * Syncs all blogs from array/DB to flatfile storage
 */
export async function syncAllBlogsToFlatfile(blogs: any[]): Promise<FlatfileSettingsStore> {
  const store: FlatfileSettingsStore = {
    updated_at: new Date().toISOString(),
    blogs: {}
  };

  for (const b of blogs) {
    let settingsObj: Record<string, any> = {};
    if (typeof b.settings_json === "string") {
      try { settingsObj = JSON.parse(b.settings_json || "{}"); } catch (e) {}
    } else if (b.settings_json && typeof b.settings_json === "object") {
      settingsObj = b.settings_json;
    }

    store.blogs[String(b.id)] = {
      blog_id: b.id,
      slug: b.slug,
      name: b.name,
      theme_id: b.theme_id || "contempo",
      custom_css: b.custom_css || "",
      settings: settingsObj,
      updated_at: new Date().toISOString()
    };
  }

  await Bun.write(FLATFILE_PATH, JSON.stringify(store, null, 2));
  return store;
}
