const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  acquirePublishLock,
  commandsForTask,
  dataPathsForTask,
  implementationStatusPaths,
  isAllowedAutoCommit,
  isPublishBranch,
  repoSlugFromRemote,
  releasePublishLock,
} = require("./auto-publish");

function testSettlementRunsChampionAutomationBeforeDerivedDataValidation() {
  // Given: the automatic settlement publisher command plan.
  const commands = commandsForTask("settle");

  // When/Then: radar refresh precedes every gauntlet call, even before strict result sync.
  assert.deepStrictEqual(commands.slice(0, 2), [
    ["npm", "run", "champion"],
    ["npm", "run", "champion:gauntlet:auto"],
  ]);
}

function testRoundtablePublisherAlsoRepairsChampionIssues() {
  // Given: the daily model-call publisher command plan.
  const commands = commandsForTask("roundtable");

  // When/Then: champion radar refresh follows schedule sync and precedes gauntlet repair.
  assert.deepStrictEqual(commands.slice(0, 3), [
    ["npm", "run", "roundtable:auto"],
    ["npm", "run", "champion"],
    ["npm", "run", "champion:gauntlet:auto"],
  ]);
}

function testDedicatedChampionPublisherRefreshesRadarFirst() {
  const commands = commandsForTask("champion");

  assert.deepStrictEqual(commands, [
    ["npm", "run", "champion"],
    ["npm", "run", "champion:gauntlet:auto"],
  ]);
}

function testPublisherGuardsChampionImplementationFiles() {
  const paths = implementationStatusPaths();

  [
    "package.json",
    "ops/launchd/com.tom.worldcup-ai-arena-results.plist",
    "pipeline/champion-gauntlet.js",
    "pipeline/champion-gauntlet-auto.js",
    "pipeline/validate-champion-gauntlet.js",
    "public/app-load-smooth.js",
  ].forEach((file) => assert.ok(paths.includes(file), file));
}

function testChampionPublisherStagesOnlyChampionData() {
  assert.deepStrictEqual(dataPathsForTask("champion"), ["public/data/champion-predictions.json"]);
}

function testRemoteAndPendingCommitChecksAreExact() {
  assert.strictEqual(repoSlugFromRemote("git@github.com:aiworldcup/aiworldcup.github.io.git"), "aiworldcup/aiworldcup.github.io");
  assert.strictEqual(repoSlugFromRemote("https://github.com/aiworldcup/aiworldcup.github.io.git"), "aiworldcup/aiworldcup.github.io");
  assert.strictEqual(isAllowedAutoCommit("Auto update champion gauntlet", ["public/data/champion-predictions.json"]), true);
  assert.strictEqual(isAllowedAutoCommit("Manual work", ["public/data/champion-predictions.json"]), false);
  assert.strictEqual(isAllowedAutoCommit("Auto update champion gauntlet", ["pipeline/champion-gauntlet.js"]), false);
  assert.strictEqual(isPublishBranch("main"), true);
  assert.strictEqual(isPublishBranch("codex/champion-auto"), false);
  assert.strictEqual(isPublishBranch(""), false);
}

function testPublishLockIsAtomicAndNeverDeletesDirectories() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worldcup-auto-lock-"));
  const lockFile = path.join(root, "publish.lock");
  const owner = acquirePublishLock(lockFile);
  try {
    assert.throws(() => acquirePublishLock(lockFile), /already running/);
  } finally {
    releasePublishLock(owner);
  }
  assert.strictEqual(fs.existsSync(lockFile), false);

  const directoryPath = path.join(root, "must-survive");
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(path.join(directoryPath, "marker"), "keep");
  assert.throws(() => acquirePublishLock(directoryPath), /already running|lock path/);
  assert.strictEqual(fs.readFileSync(path.join(directoryPath, "marker"), "utf8"), "keep");
  fs.rmSync(root, { recursive: true, force: true });
}

function testChangedDataPushUsesPendingCommitAudit() {
  const source = fs.readFileSync(path.join(__dirname, "auto-publish.js"), "utf8");
  const pushCalls = source.match(/run\("git", \["push"/g) || [];
  assert.strictEqual(pushCalls.length, 1);
  assert.match(source, /run\("git", \["commit"[\s\S]*?pushIfAhead\(taskName\);/);
}

testSettlementRunsChampionAutomationBeforeDerivedDataValidation();
testRoundtablePublisherAlsoRepairsChampionIssues();
testDedicatedChampionPublisherRefreshesRadarFirst();
testPublisherGuardsChampionImplementationFiles();
testChampionPublisherStagesOnlyChampionData();
testRemoteAndPendingCommitChecksAreExact();
testPublishLockIsAtomicAndNeverDeletesDirectories();
testChangedDataPushUsesPendingCommitAudit();
console.log("[auto-publish.test] ok");
