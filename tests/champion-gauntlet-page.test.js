const assert = require("assert");
const fs = require("fs");
const path = require("path");

function testChampionGauntletCopyUsesCurrentRoundData() {
  // Given: the static champion-page renderer source.
  const sources = ["app.js", "app-load-smooth.js"].map((file) => ({
    file,
    source: fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8"),
  }));

  // When/Then: no fixed second-round state remains and skipped/excluded data is rendered.
  for (const { file, source } of sources) {
    assert.ok(!source.includes("首轮已结算,第二轮下注中"), file);
    assert.ok(!source.includes("第二轮下注"), file);
    assert.match(source, /status === 'skipped'/, file);
    assert.match(source, /excludedMatches/, file);
    assert.match(source, /championGauntletEffectiveStatus/, file);
    assert.match(source, /championGauntletIssueCanRetry/, file);
    assert.match(source, /技术出局/, file);
    assert.match(source, /deadlineAt/, file);
    assert.ok(!source.includes("entries.some(entry => entry?.status === 'issue')"), file);
    assert.match(source, /场边\\u2060发言/, file);
    assert.match(source, /减\\u2060员/, file);
    assert.match(source, /20260711-champion-auto/, file);
  }
  const index = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(index, /styles\.css\?v=20260711-champion-auto/);
  assert.match(index, /app-load-smooth\.js\?v=20260711-champion-auto/);
}

testChampionGauntletCopyUsesCurrentRoundData();
console.log("[champion-gauntlet-page.test] ok");
