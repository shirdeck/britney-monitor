const fs = require("fs");
const path = require("path");

async function main() {
  const IFTTT_KEY = process.env.IFTTT_KEY;
  const IFTTT_EVENT = process.env.IFTTT_EVENT || "britney_post";
  const PROFILE = process.env.IG_PROFILE || "britneyspears";

  const statePath = path.join(process.cwd(), "last_seen.json");
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { last_shortcode: "" };

  // 1) fetch profile page HTML
  const resp = await fetch(`https://www.instagram.com/${PROFILE}/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!resp.ok) {
    console.error("HTTP error from Instagram:", resp.status);
    process.exit(0); // do not fail the job hard
  }

  const html = await resp.text();

  // 2) extract first post shortcode
  const m = html.match(/"shortcode":"([A-Za-z0-9_-]{5,})"/);
  if (!m) {
    console.log("No shortcode found. Page layout may have changed.");
    process.exit(0);
  }
  const shortcode = m[1];
  const postUrl = `https://www.instagram.com/p/${shortcode}/`;

  // 3) dedupe: only notify once per new post
  if (shortcode === state.last_shortcode) {
    console.log("No change.");
  } else {
    console.log("New post detected:", postUrl);

    if (!IFTTT_KEY) {
      console.log("Missing IFTTT_KEY. Skipping notification.");
    } else {
      const hook = `https://maker.ifttt.com/trigger/${IFTTT_EVENT}/with/key/${IFTTT_KEY}`;
      const body = {
        value1: shortcode,
        value2: new Date().toISOString(),
        value3: postUrl
      };

      const n = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!n.ok) {
        console.error("IFTTT error:", n.status, await n.text());
      } else {
        console.log("IFTTT notified.");
      }
    }

    // update state
    state.last_shortcode = shortcode;
    fs.writeFileSync(statePath, JSON.stringify(state));
  }
}

main().catch(err => {
  console.error("Script error:", err.message);
  // Do not throw to avoid failing the workflow repeatedly
});
