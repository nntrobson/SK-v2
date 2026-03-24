const SHOTKAM_TIMESTAMP_PATTERN = /(\d{8})(\d{6})/;
const SHOTKAM_SHOT_PATTERN = /SHOT0*(\d+)/i;

function parseShotKamDateToken(value: string): Date | null {
  const match = value.match(SHOTKAM_TIMESTAMP_PATTERN);
  if (!match) return null;

  const [, yyyymmdd, hhmmss] = match;
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const hour = Number(hhmmss.slice(0, 2));
  const minute = Number(hhmmss.slice(2, 4));
  const second = Number(hhmmss.slice(4, 6));

  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseShotKamRecordedAt(videoPath: string | null | undefined): Date | null {
  if (!videoPath) return null;
  const baseName = videoPath.split("/").pop() ?? videoPath;
  return parseShotKamDateToken(baseName);
}

export function parseShotKamShotNumber(videoPath: string | null | undefined): number | null {
  if (!videoPath) return null;
  const baseName = videoPath.split("/").pop() ?? videoPath;
  const match = baseName.match(SHOTKAM_SHOT_PATTERN);
  if (!match) return null;
  const shotNumber = Number(match[1]);
  return Number.isFinite(shotNumber) ? shotNumber : null;
}

export function formatClipOffset(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return "Time unavailable";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  const milliseconds = totalMilliseconds % 1000;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function getShotTraceDateLabel(
  videoPath: string | null | undefined,
  sessionDate: string | null | undefined,
): string {
  const recordedAt = parseShotKamRecordedAt(videoPath);
  if (recordedAt) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(recordedAt);
  }
  return sessionDate?.trim() || "Unknown date";
}

export function getShotTraceTimeLabel(
  videoPath: string | null | undefined,
  pretriggerTime: number | null | undefined,
): string {
  const recordedAt = parseShotKamRecordedAt(videoPath);
  if (recordedAt) {
    const shotMoment =
      pretriggerTime != null && Number.isFinite(pretriggerTime)
        ? new Date(recordedAt.getTime() + pretriggerTime * 1000)
        : recordedAt;
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(shotMoment);
  }

  if (pretriggerTime != null && Number.isFinite(pretriggerTime)) {
    return `Clip ${formatClipOffset(pretriggerTime)}`;
  }

  return "Time unavailable";
}

export function getShotTraceShotLabel(
  videoPath: string | null | undefined,
  rowIndex: number,
): string {
  const shotNumber = parseShotKamShotNumber(videoPath);
  if (shotNumber != null) {
    return `Shot ${shotNumber}`;
  }
  return `Row ${String(rowIndex + 1).padStart(2, "0")}`;
}
