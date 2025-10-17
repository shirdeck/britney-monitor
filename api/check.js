// api/check.js
// Node 20+ has global fetch

const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    }
  });
  return resp;
}

async function getProfileHtml(profile) {
  // 1) try Instagram directly
  let resp = await fetchHtml(`https://www.instagram.com/${profile}/`);
  if (resp.ok) return await resp.text();

  // 2) if rate-limited or other failure, fall back to a read-only mirror
  // This simply fetches the public page through a third-party reader.
  // It reduces the chance of 429 on shared GitHub IPs.
  // If this mirror ever changes, we’ll swap it out.
  if (resp.status === 429 || resp.status === 403 || resp.status === 401 || resp.status === 500) {
    const alt = await fetchHtml(`https://r.jina.ai/http://www.instagram.com/${profile}/`);
    if (alt.ok) return await alt.text();
  }

  // give up for this run
  console.log("Fetch failed with HTTP", resp.status);
  return null;
}

function extractShortcode(html) {
  if (!html) return null;

  // Primary pattern
  let m = html.match(/"shortcode":"([A-Za-z0-9_-]{5,})"/);
  if (m) return m[1];

  // Fallback pattern: sometimes appears as \u0022shortcode\u0022:\u0022CODE\u0022
  m = html.match(/\\u0022shortcode\\u0022:\\u0022([A-Za-z0-9_-]{5,})\\u0022/);
  if (m) return m[1];

  return null;
}

async function main() {
  const IFTTT_KEY = process.env.IFTTT_KEY;
  const IFTTT_EVENT = process.env.IFTTT_EVENT || "britney_post";
  const PROFILE = process.env.IG_PROFILE || "britneyspears";

  // small random jitter so we don’t always hit at the exact same second
  const jitter = Math.floor(5000 + Math.random() * 20000); // 5–25s
  await sleep(jitter);

  const statePath = path.join(process.cwd(), "last_seen.json");
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { last_shortcode: "" };

  const html = await getProfileHtml(PROFILE);
  if (!html) {
    console.log("Skipped this run due to fetch failure.");
    return;
  }

  const shortcode = extractShortcode(html);
  if (!shortcode) {
    console.log("No shortcode found. Layout may have changed.");
    return;
  }

  const postUrl = `https://www.instagram.com/p/${shortcode}/`;

  if (shortcode === state.last_shortcode) {
    console.log("No change.");
    return;
  }

  console.log("New post detected:", postUrl);

  if (!IFTTT_KEY) {
    console.log("Missing IFTTT_KEY. Skipping notification.");
  } else {
    const hook = `https://maker.ifttt.com/trigger/${IFTTT_EVENT}/with/key/${IFTTT_KEY}`;
    const body = { value1: shortcode, value2: new Date().toISOString(), value3: postUrl };
    const notif = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!notif.ok) {
      console.error("IFTTT error:", notif.status, await notif.text());
    } else {
      console.log("IFTTT notified.");
    }
  }

  state.last_shortcode = shortcode;
  fs.writeFileSync(statePath, JSON.stringify(state));
}

main().catch(err => {
  console.error("Script error:", err.message);
});
