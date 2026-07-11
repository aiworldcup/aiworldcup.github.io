const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PUBLISH_REMOTE = "origin";
const PUBLISH_BRANCH = "main";
const DEFAULT_PUBLISH_REPO = "aiworldcup/aiworldcup.github.io";
const INVALID_LOCK_GRACE_MS = 60 * 1000;
const IMPLEMENTATION_STATUS_PATHS = [
  "package.json",
  "ops/install-launchd.sh",
  "ops/launchd/com.tom.worldcup-ai-arena-results.plist",
  "pipeline/auto-publish.js",
  "pipeline/champion.js",
  "pipeline/champion-gauntlet.js",
  "pipeline/champion-gauntlet-auto.js",
  "pipeline/knockout.js",
  "pipeline/settle.js",
  "pipeline/sync-espn-results.js",
  "pipeline/sync-real-data.js",
  "pipeline/validate-champion-gauntlet.js",
  "public/app.js",
  "public/app-load-smooth.js",
  "public/index.html",
  "public/styles.css",
];

const TASKS = {
  settle: {
    commands: [
      ["npm", "run", "champion"],
      ["npm", "run", "champion:gauntlet:auto"],
      ["npm", "run", "settle:strict"],
      ["npm", "run", "champion"],
      ["npm", "run", "champion:gauntlet:auto"],
    ],
    dataPaths: [
      "public/data/champion-predictions.json",
      "public/data/espn-results.json",
      "public/data/jingcai-single.json",
      "public/data/leaderboard.json",
      "public/data/match-insights.json",
      "public/data/matches.json",
    ],
    message: "Auto update match results",
  },
  roundtable: {
    commands: [
      ["npm", "run", "roundtable:auto"],
      ["npm", "run", "champion"],
      ["npm", "run", "champion:gauntlet:auto"],
    ],
    dataPaths: [
      "public/data/champion-predictions.json",
      "public/data/discussions.json",
      "public/data/jingcai-single.json",
      "public/data/match-insights.json",
      "public/data/matches.json",
    ],
    message: "Auto generate roundtables",
  },
  champion: {
    commands: [
      ["npm", "run", "champion"],
      ["npm", "run", "champion:gauntlet:auto"],
    ],
    dataPaths: ["public/data/champion-predictions.json"],
    message: "Auto update champion gauntlet",
  },
};

function publishLockPath() {
  return path.resolve(process.cwd(), "logs", ".auto-publish.lock");
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function acquirePublishLock(lockPath = publishLockPath()) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = crypto.randomUUID();
  const owner = { path: lockPath, token, pid: process.pid, createdAt: new Date().toISOString() };

  function create() {
    const descriptor = fs.openSync(lockPath, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(owner));
    } finally {
      fs.closeSync(descriptor);
    }
    return owner;
  }

  try {
    return create();
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const stat = fs.statSync(lockPath);
    if (!stat.isFile()) throw new Error(`auto-publish lock path exists and is not a file: ${lockPath}`);
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch (_) {
      existing = null;
    }
    if (processIsAlive(Number(existing?.pid))) {
      throw new Error(`auto-publish already running with pid ${existing.pid}`);
    }
    const ageMs = Date.now() - stat.mtimeMs;
    if (!existing && (!Number.isFinite(ageMs) || ageMs < INVALID_LOCK_GRACE_MS)) {
      throw new Error("auto-publish lock is being initialized by another process");
    }
    fs.unlinkSync(lockPath);
    try {
      return create();
    } catch (retryError) {
      if (retryError.code === "EEXIST") throw new Error("auto-publish already running");
      throw retryError;
    }
  }
}

function releasePublishLock(owner) {
  if (!owner?.path || !owner?.token) return false;
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(owner.path, "utf8"));
  } catch (_) {
    return false;
  }
  if (current.token !== owner.token) return false;
  fs.unlinkSync(owner.path);
  return true;
}

function commandsForTask(taskName) {
  return (TASKS[taskName]?.commands || []).map((command) => [...command]);
}

function dataPathsForTask(taskName) {
  return [...(TASKS[taskName]?.dataPaths || [])];
}

function implementationStatusPaths() {
  return [...IMPLEMENTATION_STATUS_PATHS];
}

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

function changedDataFiles(paths) {
  const output = run("git", ["status", "--porcelain", "--", ...paths], { capture: true });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function repoSlugFromRemote(remoteUrl) {
  const raw = String(remoteUrl || "").trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const ssh = raw.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  if (ssh) return ssh[1];
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== "github.com") return "";
    return url.pathname.replace(/^\/+/, "");
  } catch (_) {
    return "";
  }
}

function isPublishBranch(branch) {
  return String(branch || "").trim() === PUBLISH_BRANCH;
}

function isAllowedAutoCommit(subject, files) {
  const allowedSubjects = new Set(Object.values(TASKS).map((task) => task.message));
  return allowedSubjects.has(subject)
    && Array.isArray(files)
    && files.length > 0
    && files.every((file) => String(file).startsWith("public/data/"));
}

function ensureImplementationCommitted() {
  const output = run("git", ["status", "--porcelain", "--", ...IMPLEMENTATION_STATUS_PATHS], { capture: true }).trim();
  if (output) {
    throw new Error(`champion automation implementation is not committed; refusing data-only publish:\n${output}`);
  }
}

function ensurePublishRemote() {
  const remoteUrl = run("git", ["remote", "get-url", PUBLISH_REMOTE], { capture: true }).trim();
  if (repoSlugFromRemote(remoteUrl) !== DEFAULT_PUBLISH_REPO) {
    throw new Error(`${PUBLISH_REMOTE} points to ${remoteUrl}; expected ${DEFAULT_PUBLISH_REPO}. Refusing to publish.`);
  }
}

function ensurePublishBranch() {
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (!isPublishBranch(branch)) {
    throw new Error(`auto-publish must run on ${PUBLISH_BRANCH}; current branch is ${branch || "detached HEAD"}`);
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
  const commits = run("git", ["log", "--format=%H%x09%s", `${PUBLISH_REMOTE}/${PUBLISH_BRANCH}..HEAD`], { capture: true })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  for (const commit of commits) {
    const files = run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commit.hash], { capture: true })
      .split(/\r?\n/)
      .filter(Boolean);
    if (!isAllowedAutoCommit(commit.subject, files)) {
      throw new Error(`refusing to push unrelated pending commit ${commit.hash} (${commit.subject})`);
    }
  }
  console.log(`[auto-publish] ${taskName}: local main is ahead by ${ahead} commit(s); push pending commits.`);
  run("git", ["push", PUBLISH_REMOTE, PUBLISH_BRANCH]);
  return true;
}

function runTask() {
  const taskName = process.argv[2] || "";
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Usage: node pipeline/auto-publish.js ${Object.keys(TASKS).join("|")}`);
    process.exit(1);
  }

  ensurePublishBranch();
  ensurePublishRemote();
  ensureImplementationCommitted();
  for (const [command, ...args] of task.commands) run(command, args);
  run("npm", ["run", "insights"]);
  run(process.execPath, ["pipeline/validate-results.js"]);
  run(process.execPath, ["pipeline/validate-predictions.js"]);
  run(process.execPath, ["pipeline/validate-match-insights.js"]);
  run(process.execPath, ["pipeline/validate-champion-gauntlet.js"]);
  run(process.execPath, ["pipeline/audit-prediction-provenance.js"]);

  const dataPaths = dataPathsForTask(taskName);
  const changed = changedDataFiles(dataPaths);
  if (!changed.length) {
    if (!pushIfAhead(taskName)) {
      console.log(`[auto-publish] ${taskName}: no public/data changes; skip commit.`);
    }
    return;
  }

  console.log(`[auto-publish] ${taskName}: changed files\n${changed.join("\n")}`);
  run("git", ["add", "--", ...dataPaths]);
  run("git", ["commit", "-m", task.message, "--", ...dataPaths]);
  pushIfAhead(taskName);
}

function main() {
  const lockOwner = acquirePublishLock();
  try {
    return runTask();
  } finally {
    releasePublishLock(lockOwner);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  acquirePublishLock,
  commandsForTask,
  dataPathsForTask,
  implementationStatusPaths,
  isAllowedAutoCommit,
  isPublishBranch,
  repoSlugFromRemote,
  releasePublishLock,
};
