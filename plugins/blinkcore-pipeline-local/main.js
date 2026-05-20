/**
 * BlinkCore Pipeline — Local Dev Plugin
 *
 * Simplified: sync only, no OSS. Points to http://127.0.0.1:8000.
 * Use this when the production plugin (blinkcore-pipeline) is disabled.
 */

"use strict";

/* ------------------------------------------------------------------ */
/*  Imports                                                           */
/* ------------------------------------------------------------------ */

const { Plugin, Notice, MarkdownView, PluginSettingTab, Setting, requestUrl } = require("obsidian");
const { createHash } = require("node:crypto");

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const API_BASE = "http://127.0.0.1:8000";
const SYNC_ENDPOINT = `${API_BASE}/api/v1/admin/sync`;
const EMBEDDING_DIM = 384;

const DEFAULT_SETTINGS = {};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function dummyEmbedding() {
  return new Array(EMBEDDING_DIM).fill(0);
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: null, visibility: "public", tags: [], rest: markdown };

  const fm = match[1];
  const titleMatch = fm.match(/^title:\s*(.+)$/m);
  const visMatch = fm.match(/^visibility:\s*(.+)$/im);
  const slugMatch = fm.match(/^slug:\s*(.+)$/m);
  const rest = markdown.slice(match[0].length).trimStart();

  let tags = [];
  const yamlListMatch = fm.match(/^tags:\n((?:\s+- .+\n?)+)/m);
  if (yamlListMatch) {
    tags = yamlListMatch[1]
      .split("\n")
      .map((l) => l.trim().replace(/^- /, "").trim())
      .filter(Boolean);
  } else {
    const tagsMatch = fm.match(/^tags:\s+(.+)$/m);
    if (tagsMatch) {
      const val = tagsMatch[1].trim();
      if (val.startsWith("[")) {
        tags = val
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        tags = val
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
  }
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    visibility: visMatch ? visMatch[1].trim().toLowerCase() : "public",
    slug: slugMatch ? slugMatch[1].trim() : null,
    tags,
    rest,
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sliceMarkdown(content) {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const chunks = [];
  let chunkIndex = 0;
  const matches = [];
  let m;
  while ((m = headingRegex.exec(content)) !== null) {
    matches.push({ index: m.index, level: m[1].length, text: m[2] });
  }
  if (matches.length === 0) {
    chunks.push({ chunk_index: 0, heading_level: 2, heading_text: "", slug_anchor: "", content: content.trim() });
    return chunks;
  }
  if (matches[0].index > 0) {
    const c = content.slice(0, matches[0].index).trim();
    if (c) chunks.push({ chunk_index: chunkIndex++, heading_level: 2, heading_text: "", slug_anchor: "", content: c });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = i + 1 < matches.length ? matches[i + 1].index : content.length;
    chunks.push({
      chunk_index: chunkIndex++,
      heading_level: cur.level === 3 ? 3 : 2,
      heading_text: cur.text,
      slug_anchor: slugify(cur.text),
      content: content.slice(cur.index, nextIdx).trim(),
    });
  }
  return chunks;
}

/* ------------------------------------------------------------------ */
/*  Plugin Main Class                                                 */
/* ------------------------------------------------------------------ */

class BlinkCorePipelineLocalPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "sync-to-blinkcore",
      name: "Sync to BlinkCore",
      callback: () => this.syncAll(),
    });

    this.addRibbonIcon("upload-cloud", "Sync to BlinkCore (Local)", () => {
      this.syncAll();
    });

    this.addSettingTab(new BlinkCoreLocalSettingTab(this.app, this));

    new Notice("BlinkCore Pipeline (Local Dev) loaded");
  }

  /* ---- Sync to BlinkCore (incremental) ---- */

  async syncAll() {
    new Notice("BlinkCore: Scanning vault...");

    try {
      const files = this.app.vault.getMarkdownFiles();
      const articles = [];
      const manifest = [];
      let changedCount = 0;

      const cache = this.settings._hashCache || {};

      for (const file of files) {
        const content = await this.app.vault.read(file);
        const slug = file.basename;
        const fm = parseFrontmatter(content);
        const title = fm.title || slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        if (fm.visibility === "private") {
          console.log(`  ${slug}: skipped (private)`);
          continue;
        }

        const contentHash = sha256(content);

        if (cache[slug] === contentHash) {
          manifest.push(slug);
          continue;
        }

        const rawContent = fm.rest;
        const chunks = sliceMarkdown(rawContent).map((chunk) => ({
          ...chunk,
          dense_embedding: dummyEmbedding(),
        }));

        articles.push({
          metadata: { slug, title, visibility: fm.visibility, content_hash: contentHash, tags: fm.tags },
          spec: { raw_content: rawContent, chunks },
        });

        manifest.push(slug);
        cache[slug] = contentHash;
        changedCount++;
      }

      const currentSlugs = new Set(files.map((f) => f.basename));
      for (const slug of Object.keys(cache)) {
        if (!currentSlugs.has(slug)) {
          delete cache[slug];
        }
      }

      this.settings._hashCache = cache;
      await this.saveSettings();

      if (articles.length === 0 && changedCount === 0) {
        new Notice("BlinkCore: All articles up to date.");
        return;
      }

      const syncCount = articles.length;
      new Notice(`BlinkCore: Syncing ${syncCount} changed / ${manifest.length} total...`);

      const response = await requestUrl({
        url: SYNC_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Verify": "SUCCESS",
        },
        body: JSON.stringify({
          apiVersion: "knowledge.your-domain.com/v1alpha1",
          kind: "KnowledgeSyncPayload",
          active_manifest: manifest,
          articles,
        }),
        contentType: "application/json",
      });

      if (response.status !== 200) {
        throw new Error(`API ${response.status}: ${response.text}`);
      }

      const result = response.json;
      new Notice(`BlinkCore: Synced ${result.synced.length} articles, pruned ${result.pruned.length}`);
    } catch (err) {
      new Notice(`BlinkCore sync failed: ${err.message}`);
      console.error("BlinkCore sync error:", err);
    }
  }

  /* ---- Settings ---- */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/* ------------------------------------------------------------------ */
/*  Settings Tab                                                      */
/* ------------------------------------------------------------------ */

class BlinkCoreLocalSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "BlinkCore Pipeline — Local Dev" });
    containerEl.createEl("p", {
      text: `Sync endpoint: ${SYNC_ENDPOINT}`,
      cls: "setting-item-description",
    });
    containerEl.createEl("p", {
      text: "This local dev version has sync only (no OSS image upload).",
      cls: "setting-item-description",
    });
  }
}

module.exports = {
  default: BlinkCorePipelineLocalPlugin,
};