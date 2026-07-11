const assert = require("assert");
const { validateResultData } = require("./validate-results");

function testFinalIncludingExtraTimeSourceDoesNotConflictWithRegularActual() {
  const outcome = validateResultData(
    {
      matches: [
        {
          id: "wc2026-ko-09",
          home: { team: "比利时" },
          away: { team: "塞内加尔" },
          actual: { result: "draw", score: "2-2" },
        },
      ],
    },
    [
      [
        "espn",
        [
          {
            matchId: "wc2026-ko-09",
            score: "3:2",
            result: "home",
            scoreScope: "finalIncludingExtraTime",
          },
        ],
      ],
    ],
  );

  assert.deepStrictEqual(outcome.conflicts, []);
}

function testRegularTimeSourceStillConflictsWhenItDiffers() {
  assert.throws(
    () => validateResultData(
      {
        matches: [
          {
            id: "wc2026-ko-09",
            home: { team: "比利时" },
            away: { team: "塞内加尔" },
            actual: { result: "draw", score: "2-2" },
          },
        ],
      },
      [
        [
          "jingcai",
          [
            {
              matchId: "wc2026-ko-09",
              officialScore: "3:2",
              scoreScope: "regularTime",
            },
          ],
        ],
      ],
    ),
    /result source conflicts=1/,
  );
}

testFinalIncludingExtraTimeSourceDoesNotConflictWithRegularActual();
testRegularTimeSourceStillConflictsWhenItDiffers();
console.log("[validate-results.test] ok");
