const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");

function read(file) {
  return fs.readFileSync(path.join(publicDir, file), "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function escapeScriptJson(data) {
  return JSON.stringify(data, null, 2).replace(/<\/script/gi, "<\\/script");
}

function stripExternalTags(html) {
  return html
    .replace(/\s*<link rel="stylesheet" href="styles\.css" \/>\s*/u, "\n")
    .replace(/\s*<script src="app\.js"><\/script>\s*/u, "\n");
}

function patchAppForStandalone(appJs) {
  const replacement = `async function loadJSON(path, fallback) {
  const data = window.__WORLD_CUP_DATA__ || {};
  const key = String(path || "").replace(/^data\\//, "");
  const fallbackKey = String(fallback || "").replace(/^data\\//, "");
  return data[key] || data[fallbackKey] || null;
}`;

  return appJs.replace(/async function loadJSON\(path, fallback\) \{[\s\S]*?\n\}/u, replacement);
}

function buildStandalone() {
  const html = stripExternalTags(read("index.html"));
  const css = read("styles.css");
  const app = patchAppForStandalone(read("app.js"));
  const data = {
    "models.json": readJson("data/models.json"),
    "matches.json": readJson("data/sample-matches.json"),
    "sample-matches.json": readJson("data/sample-matches.json"),
    "leaderboard.json": readJson("data/leaderboard.json"),
  };

  return html.replace(
    "</body>",
    `<style>\n${css}\n</style>\n<script>\nwindow.__WORLD_CUP_DATA__ = ${escapeScriptJson(data)};\n</script>\n<script>\n${app}\n</script>\n</body>`
  );
}

function main() {
  const output = process.argv[2] || path.join(root, "worldcup-ai-arena-mobile.html");
  fs.writeFileSync(output, buildStandalone(), "utf8");
  console.log(`[standalone] wrote ${output}`);
}

if (require.main === module) main();
