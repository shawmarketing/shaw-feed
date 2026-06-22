// crawl.js — Shaw Feed crawler
// Runs inside GitHub Actions (Node 20+). Fetches Google News RSS for each topic,
// parses items, dedupes, and writes feed.json to the repo.
//
// Topics are read from topics.json (which the web page edits via the GitHub API).
// No API keys required — Google News exposes a free RSS endpoint per search query.

import { writeFileSync, readFileSync, existsSync } from "node:fs";

// ---- Default topic map (used if topics.json is missing) ----------------------
const DEFAULT_TOPICS = {
  "Mystery Shopping": [
    "mystery shopping",
    "mystery shopping India",
    "mystery shopping UAE",
    "mystery shopping trends",
    "mystery shopping technology",
    "mystery shopping conference",
    "MSPA mystery shopping",
  ],
  "CX & Market Research": [
    "customer experience trends",
    "customer experience technology",
    "voice of customer",
    "market research industry",
    "ESOMAR research",
  ],
  "Customer-Facing Industries": [
    "new hotel launch India",
    "new restaurant opening India",
    "luxury retail India",
    "beauty brand launch India",
    "wellness spa India",
    "car showroom launch India",
    "telecom customer experience India",
    "banking customer experience India",
    "retail trends India",
    "hospitality trends India",
    "aviation customer experience",
    "healthcare clinic customer experience",
  ],
  "Brand & Vendor Opportunities": [
    "brand launch UAE",
    "customer experience vendor RFP",
    "mystery shopping tender",
  ],
  "AI": [
    "AI trends",
    "new AI tools",
    "AI customer experience retail",
  ],
  "Business News": [
    "India business news",
    "world business news",
  ],
  "Compliance": [
    "FSSAI new guidelines",
    "FDA food safety update",
  ],
};

// ---- Helpers -----------------------------------------------------------------

function loadTopics() {
  if (existsSync("topics.json")) {
    try {
      const t = JSON.parse(readFileSync("topics.json", "utf8"));
      if (t && typeof t === "object" && Object.keys(t).length) return t;
    } catch (e) {
      console.error("topics.json unreadable, using defaults:", e.message);
    }
  }
  return DEFAULT_TOPICS;
}

function gnewsUrl(query) {
  const q = encodeURIComponent(query);
  // hl/gl/ceid = English, India edition. Change to en-AE for UAE-first if desired.
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
}

// Tiny tolerant RSS parser (no deps). Google News RSS is well-formed enough.
function parseItems(xml, topic, query) {
  const items = [];
  const blocks = xml.split("<item>").slice(1);
  for (const b of blocks) {
    const get = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1] : "";
    };
    const clean = (s) =>
      s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .trim();

    let title = clean(get("title"));
    let link = clean(get("link"));
    const pubDate = clean(get("pubDate"));
    const sourceM = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceM ? clean(sourceM[1]) : "";
    // Google appends " - SourceName" to titles; strip if it matches source.
    if (source && title.endsWith(" - " + source)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (!title || !link) continue;
    items.push({
      title,
      link,
      source,
      pubDate,
      ts: pubDate ? new Date(pubDate).getTime() || 0 : 0,
      topic,
      query,
    });
  }
  return items;
}

async function fetchTopic(topic, query) {
  try {
    const res = await fetch(gnewsUrl(query), {
      headers: { "User-Agent": "Mozilla/5.0 ShawFeedBot" },
    });
    if (!res.ok) {
      console.error(`  ✗ ${query} → HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = parseItems(xml, topic, query);
    console.log(`  ✓ ${query} → ${items.length}`);
    return items;
  } catch (e) {
    console.error(`  ✗ ${query} → ${e.message}`);
    return [];
  }
}

// ---- Main --------------------------------------------------------------------

async function main() {
  const topics = loadTopics();
  const all = [];

  for (const [topic, queries] of Object.entries(topics)) {
    console.log(`\n# ${topic}`);
    for (const q of queries) {
      const items = await fetchTopic(topic, q);
      all.push(...items);
      await new Promise((r) => setTimeout(r, 300)); // be polite
    }
  }

  // Dedupe by normalized title (keep newest).
  const seen = new Map();
  for (const it of all) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    const existing = seen.get(key);
    if (!existing || it.ts > existing.ts) seen.set(key, it);
  }

  let feed = [...seen.values()].sort((a, b) => b.ts - a.ts);

  // Keep last 30 days + cap total to keep feed.json light.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  feed = feed.filter((it) => it.ts === 0 || it.ts >= cutoff).slice(0, 600);

  const out = {
    generatedAt: new Date().toISOString(),
    count: feed.length,
    topics: Object.keys(topics),
    items: feed,
  };

  writeFileSync("feed.json", JSON.stringify(out, null, 2));
  console.log(`\n✅ Wrote feed.json — ${feed.length} items across ${Object.keys(topics).length} topics`);
}

main();
