const { settle } = require("./settle");

const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_DURATION_SECONDS = 6 * 60 * 60;

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function toPositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleWatch() {
  const intervalSeconds = toPositiveNumber(argValue("interval") || process.env.SETTLE_WATCH_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS);
  const durationSeconds = toPositiveNumber(argValue("duration") || process.env.SETTLE_WATCH_DURATION_SECONDS, DEFAULT_DURATION_SECONDS);
  const startedAt = Date.now();
  const endAt = startedAt + durationSeconds * 1000;
  let round = 1;

  console.log(`[settle-watch] start interval=${intervalSeconds}s duration=${durationSeconds}s`);
  while (Date.now() <= endAt) {
    const stamp = new Date().toISOString();
    console.log(`[settle-watch] round=${round} at=${stamp}`);
    try {
      await settle();
    } catch (err) {
      console.warn(`[settle-watch] round=${round} failed: ${err.message}`);
    }
    round += 1;
    if (Date.now() + intervalSeconds * 1000 > endAt) break;
    await sleep(intervalSeconds * 1000);
  }
  console.log("[settle-watch] done");
}

if (require.main === module) {
  settleWatch().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { settleWatch };
