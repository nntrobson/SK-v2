import assert from "node:assert/strict";
import test from "node:test";

import {
  describeHorizontalOffset,
  describeVerticalOffset,
  getHorizontalMeaningForPresentation,
  getShotPatternSummary,
} from "./shot-placement-insights.ts";

test("describeHorizontalOffset returns centered when nearly zero", () => {
  assert.equal(describeHorizontalOffset(0.04), "Centered");
});

test("describeHorizontalOffset formats right and left offsets", () => {
  assert.equal(describeHorizontalOffset(1.8), '1.8" Right');
  assert.equal(describeHorizontalOffset(-2.1), '2.1" Left');
});

test("describeVerticalOffset formats high and low offsets", () => {
  assert.equal(describeVerticalOffset(2.4), '2.4" High');
  assert.equal(describeVerticalOffset(-1.2), '1.2" Low');
});

test("getHorizontalMeaningForPresentation maps drift to angle-aware guidance", () => {
  assert.equal(getHorizontalMeaningForPresentation("hard_right", 2), "Behind");
  assert.equal(getHorizontalMeaningForPresentation("hard_right", -2), "Ahead");
  assert.equal(getHorizontalMeaningForPresentation("hard_left", 2), "Ahead");
  assert.equal(getHorizontalMeaningForPresentation("hard_left", -2), "Behind");
  assert.equal(getHorizontalMeaningForPresentation("all", 2), "Target stayed right of bead");
});

test("getShotPatternSummary highlights miss drift relative to break cluster", () => {
  const summary = getShotPatternSummary({
    filter: "hard_right",
    hitsCount: 9,
    missesCount: 4,
    averageHitPosition: { x: 0.5, y: 1.3 },
    averageMissPosition: { x: 2.1, y: 0.7 },
    averageVisiblePosition: { x: 1.0, y: 1.1 },
  });

  assert.match(summary.headline, /Breaks cluster/i);
  assert.match(summary.detail, /misses leak/i);
  assert.match(summary.coaching, /behind/i);
});

test("getShotPatternSummary handles sessions without successful breaks", () => {
  const summary = getShotPatternSummary({
    filter: "all",
    hitsCount: 0,
    missesCount: 3,
    averageHitPosition: null,
    averageMissPosition: { x: -1.6, y: -0.9 },
    averageVisiblePosition: { x: -1.6, y: -0.9 },
  });

  assert.match(summary.headline, /No break cluster yet/i);
  assert.match(summary.detail, /left of .*bead/i);
  assert.match(summary.coaching, /gun move/i);
});

test("getShotPatternSummary avoids duplicated bead wording when centered", () => {
  const summary = getShotPatternSummary({
    filter: "all",
    hitsCount: 2,
    missesCount: 0,
    averageHitPosition: { x: 0, y: 0 },
    averageMissPosition: null,
    averageVisiblePosition: { x: 0, y: 0 },
  });

  assert.equal(summary.headline, "Breaks cluster on top of the bead.");
});
