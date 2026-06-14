const { spawnSync } = require("child_process");

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

function main() {
  const taskName = process.argv[2] || "";
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Usage: node pipeline/auto-publish.js ${Object.keys(TASKS).join("|")}`);
    process.exit(1);
  }

  const [command, ...args] = task.command;
  run(command, args);

  const changed = changedDataFiles();
  if (!changed.length) {
    console.log(`[auto-publish] ${taskName}: no public/data changes; skip commit.`);
    return;
  }

  console.log(`[auto-publish] ${taskName}: changed files\n${changed.join("\n")}`);
  run("git", ["add", "public/data"]);
  run("git", ["commit", "-m", task.message]);
  run("git", ["push", "origin", "main"]);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}
