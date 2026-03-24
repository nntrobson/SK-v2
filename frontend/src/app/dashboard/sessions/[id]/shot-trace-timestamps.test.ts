import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClipOffset,
  getShotTraceDateLabel,
  getShotTraceShotLabel,
  getShotTraceTimeLabel,
  parseShotKamRecordedAt,
  parseShotKamShotNumber,
} from "./shot-trace-timestamps.ts";

test("parseShotKamRecordedAt reads date and time from ShotKam-style filenames", () => {
  const recordedAt = parseShotKamRecordedAt("/tmp/20240608125600SHOT0081.MP4");

  assert.ok(recordedAt instanceof Date);
  assert.equal(recordedAt?.getFullYear(), 2024);
  assert.equal(recordedAt?.getMonth(), 5);
  assert.equal(recordedAt?.getDate(), 8);
  assert.equal(recordedAt?.getHours(), 12);
  assert.equal(recordedAt?.getMinutes(), 56);
  assert.equal(recordedAt?.getSeconds(), 0);
});

test("formatClipOffset renders mm:ss.mmm", () => {
  assert.equal(formatClipOffset(4.24), "00:04.240");
  assert.equal(formatClipOffset(74.031), "01:14.031");
});

test("shot trace labels prefer recorded timestamp from filename", () => {
  assert.equal(
    getShotTraceDateLabel("/tmp/20240608125600SHOT0081.MP4", "Jun 9, 2024"),
    "Jun 8, 2024",
  );
  assert.equal(
    getShotTraceTimeLabel("/tmp/20240608125600SHOT0081.MP4", 4.24),
    "12:56:04 PM",
  );
  assert.equal(
    getShotTraceShotLabel("/tmp/20240608125600SHOT0081.MP4", 1),
    "Shot 81",
  );
});

test("shot trace labels fall back to session date and clip offset", () => {
  assert.equal(
    getShotTraceDateLabel("/tmp/7c34401c-1e89-41fe-ab6f-2c96869a473b.MP4", "Mar 24, 2026"),
    "Mar 24, 2026",
  );
  assert.equal(
    getShotTraceTimeLabel("/tmp/7c34401c-1e89-41fe-ab6f-2c96869a473b.MP4", 4.24),
    "Clip 00:04.240",
  );
  assert.equal(
    getShotTraceShotLabel("/tmp/7c34401c-1e89-41fe-ab6f-2c96869a473b.MP4", 4),
    "Row 05",
  );
});

test("parseShotKam helpers work when the stored filename has a UUID prefix", () => {
  const path = "/tmp/7c34401c-1e89-41fe-ab6f-2c96869a473b_20240608125600SHOT0081.MP4";

  assert.equal(parseShotKamRecordedAt(path)?.getHours(), 12);
  assert.equal(parseShotKamShotNumber(path), 81);
  assert.equal(getShotTraceShotLabel(path, 2), "Shot 81");
});
