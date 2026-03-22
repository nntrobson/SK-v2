export interface AveragePosition {
  x: number;
  y: number;
}

export interface ShotPatternSummaryInput {
  filter: string;
  hitsCount: number;
  missesCount: number;
  averageHitPosition: AveragePosition | null;
  averageMissPosition: AveragePosition | null;
  averageVisiblePosition: AveragePosition | null;
}

export interface ShotPatternSummary {
  headline: string;
  detail: string;
  coaching: string;
}

const OFFSET_EPSILON = 0.15;

function isCentered(value: number): boolean {
  return Math.abs(value) < OFFSET_EPSILON;
}

function formatMagnitude(value: number): string {
  return `${Math.abs(value).toFixed(1)}"`;
}

function formatPresentationLabel(filter: string): string {
  if (filter === "all") return "mixed presentations";
  return filter.replace(/_/g, " ");
}

function joinOffsetParts(parts: string[]): string {
  if (parts.length === 0) {
    return "around the bead";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]} and ${parts[1]}`;
}

function describeAbsoluteOffset(position: AveragePosition | null): string {
  if (!position) {
    return "around the bead";
  }

  const parts: string[] = [];
  if (!isCentered(position.y)) {
    parts.push(`${formatMagnitude(position.y)} ${position.y > 0 ? "high" : "low"}`);
  }
  if (!isCentered(position.x)) {
    parts.push(`${formatMagnitude(position.x)} ${position.x > 0 ? "right" : "left"}`);
  }

  return joinOffsetParts(parts);
}

function describeBeadRelativePosition(position: AveragePosition | null): string {
  const description = describeAbsoluteOffset(position);
  return description === "around the bead" ? "on top of the bead" : `${description} of the bead`;
}

function describeRelativeDrift(hit: AveragePosition, miss: AveragePosition): string {
  const horizontal = miss.x - hit.x;
  const vertical = miss.y - hit.y;
  const parts: string[] = [];

  if (!isCentered(horizontal)) {
    parts.push(`${formatMagnitude(horizontal)} farther ${horizontal > 0 ? "right" : "left"}`);
  }
  if (!isCentered(vertical)) {
    parts.push(`${formatMagnitude(vertical)} ${vertical > 0 ? "higher" : "lower"}`);
  }

  if (parts.length === 0) {
    return "almost on top of the break cluster";
  }

  return joinOffsetParts(parts);
}

export function describeHorizontalOffset(value: number): string {
  if (isCentered(value)) {
    return "Centered";
  }
  return `${formatMagnitude(value)} ${value > 0 ? "Right" : "Left"}`;
}

export function describeVerticalOffset(value: number): string {
  if (isCentered(value)) {
    return "Centered";
  }
  return `${formatMagnitude(value)} ${value > 0 ? "High" : "Low"}`;
}

export function getHorizontalMeaningForPresentation(filter: string, xValue: number): string {
  if (isCentered(xValue)) {
    return "Centered";
  }

  const isRightGoing = filter === "hard_right" || filter === "moderate_right";
  const isLeftGoing = filter === "hard_left" || filter === "moderate_left";

  if (isRightGoing) {
    return xValue > 0 ? "Behind" : "Ahead";
  }

  if (isLeftGoing) {
    return xValue > 0 ? "Ahead" : "Behind";
  }

  return `Target stayed ${xValue > 0 ? "right" : "left"} of bead`;
}

function getCoachingLine(filter: string, position: AveragePosition | null): string {
  if (!position) {
    return "Add a few more shots to establish a reliable pattern.";
  }

  const horizontalMeaning = getHorizontalMeaningForPresentation(filter, position.x);
  const hasHorizontalStory = !isCentered(position.x);
  const hasVerticalStory = !isCentered(position.y);

  if (filter !== "all" && hasHorizontalStory) {
    return `On ${formatPresentationLabel(filter)} targets, this horizontal drift reads ${horizontalMeaning.toLowerCase()}. Clean up the gun move there before changing anything else.`;
  }

  if (hasVerticalStory) {
    return position.y > 0
      ? "The clay is staying above the bead, so the gun is finishing low. Lift the gun move through the target."
      : "The clay is staying below the bead, so the gun is finishing high. Soften the gun move at the finish and stay in the bird.";
  }

  if (hasHorizontalStory) {
    return `The clay is consistently ${position.x > 0 ? "right" : "left"} of the bead. Tighten the gun move so the picture settles closer to center.`;
  }

  return "Your pattern is centered. Focus on making the move repeatable shot to shot.";
}

export function getShotPatternSummary(input: ShotPatternSummaryInput): ShotPatternSummary {
  const {
    filter,
    hitsCount,
    missesCount,
    averageHitPosition,
    averageMissPosition,
    averageVisiblePosition,
  } = input;

  if (!averageHitPosition) {
    return {
      headline: "No break cluster yet",
      detail: averageVisiblePosition
        ? `Visible shots are sitting ${describeBeadRelativePosition(averageVisiblePosition)}.`
        : "Take a few more shots to establish a visible pattern.",
      coaching: averageVisiblePosition
        ? `${getCoachingLine(filter, averageVisiblePosition)} Keep the first adjustment small so you can see the pattern move.`
        : "Keep the gun move simple and gather a few more reps before making a bigger adjustment.",
    };
  }

  const headline = `Breaks cluster ${describeBeadRelativePosition(averageHitPosition)}.`;

  let detail = hitsCount > 1
    ? `Your ${hitsCount} breaks are forming the main window there.`
    : "You have a single break marker so far.";

  if (missesCount > 0 && averageMissPosition) {
    detail = `Compared with the break cluster, misses leak ${describeRelativeDrift(averageHitPosition, averageMissPosition)}.`;
  } else if (averageVisiblePosition) {
    detail = `All visible shots average ${describeBeadRelativePosition(averageVisiblePosition)}.`;
  }

  const coachingTarget = averageMissPosition ?? averageVisiblePosition ?? averageHitPosition;
  return {
    headline,
    detail,
    coaching: getCoachingLine(filter, coachingTarget),
  };
}
