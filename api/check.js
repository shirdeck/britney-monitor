const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });
  return resp;
}

async function getProfileHtml(profile) {
  // 1) Try Instagram directly
  let resp = await fetchHtml(`https://www.instagram.com/${profile}/`);
  if (resp.ok) return await resp.text();

  // 2) If rate-limited, fallback to a public mirror
  if ([429, 403, 401, 500].includes(resp.status)) {
    console.log("Primary fetch failed with", resp.status, "— using mirror");
    const alt = await fetchHtml(
      `https://r.jina.ai/http://www.instagram.com/${profile}/`
    );
    if (alt.ok) return await alt.text();
  }

  console.log("Fetch failed with HTTP", resp.status);
  return null;
}

function extractShortcode(html) {
  if (!html) return null;

  // 1. Regular pattern
  let m = html.match(/"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,})"/);
  if (m) return m[1];

  // 2. Escaped Unicode version
  m = html.match(/\\u0022shortcode\\u0022\\s*:\\s*\\u0022([A-Za-z0-9_-]{5,})\\u0022/);
  if (m) return m[1];

  // 3. HTML href="/p/XXXX/"
  m = html.match(/href="\/p\/([A-Za-z0-9_-]{5,})\//);
  if (m) return m[1];

  // 4. Escaped href JSON
  m = html.match(/"href":"\\\/p\\\/([A-Za-z0-9_-]{5,})\\\//);
  if (m) return m[1];

  // 5. Any instagram.com/p/ reference
  m = html.match(/instagram\.com\/p\/([A-Za-z0-9_-]{5,})/);
  if (m) return m[1];

  return null;
}

async function main() {
  const IFTTT_KEY = process.env.IFTTT_KEY;
  const IFTTT_EVENT = process.env.IFTTT_EVENT || "britney_post";
  const PROFILE = process.env.IG_PROFILE || "britneyspears";

  // random delay 15–60s to avoid rate limit
  const jitter = Math.floor(15000 + Math.random() * 45000);
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
    console.log("No shortcode found. First 400 chars of HTML:");
    console.log(html.slice(0, 400));
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
    const payload = {
      value1: shortcode,
      value2: new Date().toISOString(),
      value3: postUrl,
    };

    try {
      const res = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log("IFTTT notified successfully.");
      } else {
        console.log("IFTTT error:", res.status, await res.text());
      }
    } catch (err) {
      console.log("Error calling IFTTT:", err.message);
    }
  }

  state.last_shortcode = shortcode;
  fs.writeFileSync(statePath, JSON.stringify(state));
}

main().catch((err) => console.error("Script error:", err.message));
