/**
 * BlinkCore Pipeline — Obsidian Plugin
 *
 * Features:
 *   1. Sync vault notes to BlinkCore knowledge base
 *   2. Paste image → auto-upload to Alibaba Cloud OSS
 */

"use strict";

/* ------------------------------------------------------------------ */
/*  Imports                                                           */
/* ------------------------------------------------------------------ */

const { Plugin, Notice, MarkdownView, PluginSettingTab, Setting, requestUrl } = require("obsidian");
const { createHash, createHmac, randomUUID } = require("node:crypto");

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const API_BASE = "https://your-domain.com";
const SYNC_ENDPOINT = `${API_BASE}/api/v1/admin/sync`;
const API_KEY = "YOUR_API_KEY_HERE";
const EMBEDDING_DIM = 384;
const MAX_BATCH_BYTES = 400 * 1024; // 每批最大 400KB（避免 CDN/代理 413）

const DEFAULT_SETTINGS = {
  ossBucket: "",
  ossRegion: "",
  ossAccessKeyId: "",
  ossAccessKeySecret: "",
};

/* ------------------------------------------------------------------ */
/*  OSS Helpers                                                        */
/* ------------------------------------------------------------------ */

function ossEndpoint(bucket, region) {
  return `https://${bucket}.${region}.aliyuncs.com`;
}

/**
 * OSS v1 signature (virtual-hosted style).
 * StringToSign = VERB + "\n" + MD5 + "\n" + CT + "\n" + DATE + "\n" + Resource
 * Resource = /object-key  (bucket NOT in path for virtual-hosted style)
 */
function ossSign(verb, md5, contentType, date, resource, secret) {
  const str = `${verb}\n${md5}\n${contentType}\n${date}\n${resource}`;
  return createHmac("sha1", secret).update(str).digest("base64");
}

function extToMime(ext) {
  const map = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
  return map[ext.toLowerCase()] || "image/png";
}

/** Upload an ArrayBuffer to OSS, return public URL */
async function uploadToOSS(buf, fileName, settings, debugTag) {
  const ext = (fileName.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/, "png");
  const contentType = extToMime(ext);
  const objectKey = `uploads/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const date = new Date().toUTCString();
  const resource = `/${settings.ossBucket}/${objectKey}`;

  const sig = ossSign("PUT", "", contentType, date, resource, settings.ossAccessKeySecret);
  const url = `${ossEndpoint(settings.ossBucket, settings.ossRegion)}/${objectKey}`;

  console.log(`[OSS ${debugTag || "upload"}] PUT ${url}`);
  console.log(`[OSS ${debugTag || "upload"}] Date: ${date}`);
  console.log(`[OSS ${debugTag || "upload"}] Content-Type: ${contentType}`);
  console.log(`[OSS ${debugTag || "upload"}] Authorization: OSS ${settings.ossAccessKeyId}:${sig}`);
  console.log(`[OSS ${debugTag || "upload"}] buf size: ${buf.byteLength}`);

  const resp = await requestUrl({
    url,
    method: "PUT",
    contentType,
    body: buf,
    headers: {
      Date: date,
      Authorization: `OSS ${settings.ossAccessKeyId}:${sig}`,
    },
  });

  if (resp.status !== 200) {
    console.error(`[OSS ${debugTag || "upload"}] FAILED: status=${resp.status}, text=${resp.text}`);
    throw new Error(`OSS returned ${resp.status}`);
  }

  console.log(`[OSS ${debugTag || "upload"}] SUCCESS`);
  return url;
}

/* ------------------------------------------------------------------ */
/*  Helper (unchanged from v1)                                        */
/* ------------------------------------------------------------------ */

function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function dummyEmbedding() {
  return new Array(EMBEDDING_DIM).fill(0);
}

function parseFrontmatter(markdown) {
  // 支持 \r\n 和 \n 换行符
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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
    matches.push({ index: m.index, level: m[1].length, text: m[2].replace(/\r$/, "") });
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

class BlinkCorePipelinePlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // --- Command: Sync to BlinkCore ---
    this.addCommand({
      id: "sync-to-blinkcore",
      name: "Sync to BlinkCore",
      callback: () => this.syncAll(),
    });

    // --- Command: Force Sync (Clear Cache) ---
    this.addCommand({
      id: "force-sync-blinkcore",
      name: "Force Sync to BlinkCore (Clear Cache)",
      callback: () => this.syncAll(true),
    });

    this.addRibbonIcon("upload-cloud", "Sync to BlinkCore", () => {
      this.syncAll();
    });

    // --- Command: Test OSS Connection ---
    this.addCommand({
      id: "test-oss-connection",
      name: "Test OSS Connection",
      callback: () => this.testOSS(),
    });

    // --- Paste handler: image → OSS (via editor-paste for reliable Obsidian integration) ---
    this.registerEvent(this.app.workspace.on("editor-paste", (evt, editor, markdownView) => {
      this.onPaste(evt);
    }));

    // --- Settings tab ---
    this.addSettingTab(new BlinkCoreSettingTab(this.app, this));

    new Notice("BlinkCore Pipeline loaded");
  }

  /* ---- Image paste -> OSS upload -> insert markdown ---- */

  async onPaste(evt) {
    if (!this.settings.ossBucket || !this.settings.ossAccessKeyId) return;

    const items = evt.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/") && item.kind === "file") {
        evt.preventDefault();

        const file = item.getAsFile();
        if (!file) continue;

        try {
          const buf = await file.arrayBuffer();
          const url = await uploadToOSS(buf, file.name || "clipboard.png", this.settings);
          const editor = this.getActiveEditor();
          if (editor) {
            editor.replaceSelection(`![${file.name || "image"}](${url})`);
          }
          new Notice("Image uploaded to OSS");
        } catch (err) {
          new Notice(`OSS upload failed: ${err.message}`);
          console.error("OSS upload error:", err);
        }
        return;
      }
    }
  }

  getActiveEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor : null;
  }

  /* ---- Sync to BlinkCore (incremental) ---- */

  async syncAll(force = false) {
    new Notice("BlinkCore: Scanning vault...");

    try {
      const files = this.app.vault.getMarkdownFiles();
      const articles = [];
      const manifest = [];
      let changedCount = 0;
      let skippedPrivate = 0;
      let skippedCached = 0;

      // Load cached hashes from plugin data (clear if force sync)
      const cache = force ? {} : (this.settings._hashCache || {});

      if (force) {
        console.log(`[BlinkCore] Force sync: cache cleared`);
        new Notice("BlinkCore: Cache cleared, force syncing all articles...");
      }

      console.log(`[BlinkCore] Total files in vault: ${files.length}`);
      console.log(`[BlinkCore] Cached hashes: ${Object.keys(cache).length}`);

      for (const file of files) {
        const content = await this.app.vault.read(file);
        const slug = file.basename;
        const fm = parseFrontmatter(content);
        const title = fm.title || slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        if (fm.visibility === "private") {
          console.log(`  ${slug}: skipped (private)`);
          skippedPrivate++;
          continue;
        }

        const contentHash = sha256(content);

        // Incremental: skip if content unchanged
        if (cache[slug] === contentHash) {
          manifest.push(slug);
          skippedCached++;
          continue;
        }

        const rawContent = fm.rest;
        const chunks = sliceMarkdown(rawContent).map((chunk) => ({
          ...chunk,
          dense_embedding: dummyEmbedding(),
        }));

        console.log(`[BlinkCore] ${slug}: ${chunks.length} chunks, raw_content=${rawContent.length} chars`);

        articles.push({
          metadata: { slug, title, visibility: fm.visibility, content_hash: contentHash, tags: fm.tags },
          spec: { raw_content: rawContent, chunks },
        });

        manifest.push(slug);
        cache[slug] = contentHash;
        changedCount++;
      }

      console.log(`[BlinkCore] Results: ${articles.length} to sync, ${skippedPrivate} private, ${skippedCached} cached`);
      console.log(`[BlinkCore] Manifest size: ${manifest.length}`);

      // Prune cache: remove entries for deleted files
      const currentSlugs = new Set(files.map((f) => f.basename));
      for (const slug of Object.keys(cache)) {
        if (!currentSlugs.has(slug)) {
          delete cache[slug];
        }
      }

      // Save updated hashes
      this.settings._hashCache = cache;
      await this.saveSettings();

      const syncCount = articles.length;
      if (syncCount === 0) {
        new Notice(`BlinkCore: Sending manifest (${manifest.length} articles) to sync deletions...`);
      } else {
        new Notice(`BlinkCore: Syncing ${syncCount} changed / ${manifest.length} total...`);
      }

      // 分批发送，每批最多 BATCH_SIZE 篇文章
      let totalSynced = 0;
      let totalPruned = 0;

      if (articles.length === 0) {
        // 没有文章需要同步，只发送 manifest 用于 GC
        const bodyStr = JSON.stringify({
          apiVersion: "knowledge.your-domain.com/v1alpha1",
          kind: "KnowledgeSyncPayload",
          active_manifest: manifest,
          articles: [],
        });

        console.log(`[BlinkCore] Manifest-only request: ${manifest.length} slugs, body=${bodyStr.length} bytes`);

        const response = await requestUrl({
          url: SYNC_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
          },
          body: bodyStr,
          contentType: "application/json",
        });

        if (response.status !== 200) {
          const errMsg = response.status >= 500
            ? `Server error ${response.status}. Backend may be down.`
            : `API ${response.status}: ${response.text}`;
          console.error(`[BlinkCore] Manifest request FAILED: ${errMsg}`);
          throw new Error(errMsg);
        }

        const result = response.json;
        totalPruned = result.pruned.length;
      } else {
        // 按大小分批发送文章（避免 CDN/代理 413）
        // 预估 manifest 基础大小
        const basePayload = {
          apiVersion: "knowledge.your-domain.com/v1alpha1",
          kind: "KnowledgeSyncPayload",
          active_manifest: manifest,
          articles: [],
        };
        const baseSize = JSON.stringify(basePayload).length;

        const batches = [];
        let currentBatch = [];
        let currentSize = baseSize;

        for (const article of articles) {
          const articleSize = JSON.stringify(article).length + 2; // +2 for comma
          if (currentBatch.length > 0 && currentSize + articleSize > MAX_BATCH_BYTES) {
            batches.push(currentBatch);
            currentBatch = [];
            currentSize = baseSize;
          }
          currentBatch.push(article);
          currentSize += articleSize;
        }
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }

        new Notice(`BlinkCore: Sending ${batches.length} batches...`);

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const isLastBatch = i === batches.length - 1;

          const bodyStr = JSON.stringify({
            apiVersion: "knowledge.your-domain.com/v1alpha1",
            kind: "KnowledgeSyncPayload",
            active_manifest: manifest,
            articles: batch,
          });

          console.log(`[BlinkCore] Batch ${i + 1}/${batches.length}: ${batch.length} articles, body=${bodyStr.length} bytes, manifest=${manifest.length} slugs`);

          const response = await requestUrl({
            url: SYNC_ENDPOINT,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": API_KEY,
            },
            body: bodyStr,
            contentType: "application/json",
          });

          if (response.status !== 200) {
            const errMsg = response.status === 413
              ? `Request too large (${bodyStr.length} bytes). Try reducing MAX_BATCH_BYTES.`
              : response.status >= 500
                ? `Server error ${response.status}. Backend may be down.`
                : `API ${response.status}: ${response.text}`;
            console.error(`[BlinkCore] Batch ${i + 1} FAILED: ${errMsg}`);
            throw new Error(errMsg);
          }

          const result = response.json;
          totalSynced += result.synced.length;

          // 只在最后一批执行 GC
          if (isLastBatch) {
            totalPruned = result.pruned.length;
          }

          // 显示进度
          if (batches.length > 1) {
            new Notice(`BlinkCore: Batch ${i + 1}/${batches.length} done (${totalSynced} synced)...`);
          }
        }
      }

      new Notice(`BlinkCore: Synced ${totalSynced} articles, pruned ${totalPruned}`);
    } catch (err) {
      new Notice(`BlinkCore sync failed: ${err.message}`);
      console.error("BlinkCore sync error:", err);
    }
  }

  /* ---- Test OSS ---- */

  async testOSS() {
    if (!this.settings.ossBucket || !this.settings.ossAccessKeyId) {
      new Notice("Please configure OSS settings first");
      return;
    }
    new Notice("Testing OSS connection... Check console (Ctrl+Shift+I)");

    // 1x1 pixel PNG (small valid file)
    const tinyPng = new Uint8Array([
      0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
      0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0x60,0x60,0x60,0x00,
      0x00,0x00,0x04,0x00,0x01,0x27,0x34,0x27,0x2D,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,
      0x44,0xAE,0x42,0x60,0x82
    ]).buffer;

    try {
      const url = await uploadToOSS(tinyPng, "test.png", this.settings, "test");
      new Notice(`OSS OK: ${url}`);
    } catch (err) {
      new Notice(`OSS test failed: ${err.message}`);
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

class BlinkCoreSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "BlinkCore Pipeline Settings" });

    // --- OSS Section ---
    containerEl.createEl("h3", { text: "Aliyun OSS — Image Upload" });
    containerEl.createEl("p", {
      text: "Configure Alibaba Cloud OSS so pasted images auto-upload.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Bucket")
      .setDesc("OSS bucket name")
      .addText((t) =>
        t.setPlaceholder("your-bucket").setValue(this.plugin.settings.ossBucket).onChange(async (v) => {
          this.plugin.settings.ossBucket = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Region")
      .setDesc("e.g. oss-cn-shanghai")
      .addText((t) =>
        t.setPlaceholder("oss-cn-shanghai").setValue(this.plugin.settings.ossRegion).onChange(async (v) => {
          this.plugin.settings.ossRegion = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AccessKey ID")
      .addText((t) =>
        t.setPlaceholder("YOUR_ACCESS_KEY_ID...").setValue(this.plugin.settings.ossAccessKeyId).onChange(async (v) => {
          this.plugin.settings.ossAccessKeyId = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AccessKey Secret")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("xxx").setValue(this.plugin.settings.ossAccessKeySecret).onChange(async (v) => {
          this.plugin.settings.ossAccessKeySecret = v.trim();
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "BlinkCore Sync" });
    new Setting(containerEl)
      .setName("Server URL")
      .setDesc(SYNC_ENDPOINT)
      .setDisabled(true);

    // --- Fill current values ---
    if (this.plugin.settings.ossBucket) {
      containerEl.createEl("p", {
        text: `OSS endpoint: ${ossEndpoint(this.plugin.settings.ossBucket, this.plugin.settings.ossRegion)}`,
        cls: "setting-item-description",
      });
    }
  }
}

module.exports = {
  default: BlinkCorePipelinePlugin,
};
