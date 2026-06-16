const { spawnSync } = require("child_process");

const PUBLISH_REMOTE = "origin";
const PUBLISH_BRANCH = "main";
const DEFAULT_PUBLISH_REPO = "aiworldcup/aiworldcup.github.io";
const EXPECTED_PUBLISH_REPO = process.env.PUBLISH_REPO || DEFAULT_PUBLISH_REPO;

const TASKS = {
  settle: {
    command: ["npm", "run", "settle"],
    message: "Auto update match results",
  },
  roundtable: {
    command: ["npm", "run", "roundtable:auto"],
    message: "Auto generate roundtables",
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `: ${output}` : ""}`);
  }
  return result.stdout || "";
}

function changedDataFiles() {
  const output = run("git", ["status", "--porcelain", "--", "public/data"], { capture: true });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensurePublishRemote() {
  const remoteUrl = run("git", ["remote", "get-url", PUBLISH_REMOTE], { capture: true }).trim();
  if (!remoteUrl.includes(EXPECTED_PUBLISH_REPO)) {
    throw new Error(`${PUBLISH_REMOTE} points to ${remoteUrl}; expected ${EXPECTED_PUBLISH_REPO}. Refusing to publish.`);
  }
}

function localAheadCount() {
  const output = run("git", ["rev-list", "--left-right", "--count", `${PUBLISH_REMOTE}/${PUBLISH_BRANCH}...HEAD`], { capture: true }).trim();
  const [, ahead = "0"] = output.split(/\s+/);
  return Number(ahead) || 0;
}

function pushIfAhead(taskName) {
  const ahead = localAheadCount();
  if (!ahead) return false;
  console.log(`[auto-publish] ${taskName}: local main is ahead by ${ahead} commit(s); push pending commits.`);
  run("git", ["push", PUBLISH_REMOTE, PUBLISH_BRANCH]);
  return true;
}

function main() {
  const taskName = process.argv[2] || "";
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Usage: node pipeline/auto-publish.js ${Object.keys(TASKS).join("|")}`);
    process.exit(1);
  }

  const [command, ...args] = task.command;
  ensurePublishRemote();
  run(command, args);
  run(process.execPath, ["pipeline/validate-predictions.js"]);

  const changed = changedDataFiles();
  if (!changed.length) {
    if (!pushIfAhead(taskName)) {
      console.log(`[auto-publish] ${taskName}: no public/data changes; skip commit.`);
    }
    return;
  }

  console.log(`[auto-publish] ${taskName}: changed files\n${changed.join("\n")}`);
  run("git", ["add", "public/data"]);
  run("git", ["commit", "-m", task.message]);
  run("git", ["push", PUBLISH_REMOTE, PUBLISH_BRANCH]);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}
