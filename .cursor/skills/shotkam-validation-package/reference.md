# Validation Package Standard

## Folder Layout

Each generated package should follow this structure:

```text
<run_dir>/
  batch_summary.csv
  batch_manifest.json
  <video_stem>/
    manifest.json
    extracted_data.csv
    validation_review.mp4
    original_video/
      <original filename>.MP4
    screenshots/
      00_start_frame_00000.jpg
      01_first_trap_house_frame_00018.jpg
      02_pretrigger_frame_00054.jpg
      ...
```

## CSV Expectations

`extracted_data.csv` should include at least:
- `frame_idx`
- `time_ms`
- `is_pretrigger_frame`
- `class_name`
- `confidence`
- bounding-box coordinates and size
- crosshair location
- primary class for the frame
- station prediction
- break prediction
- presentation prediction

## Screenshot Rules

Generate `15-20` screenshots for each package.

Always include:
- `start`
- `first_trap_house`
- `pretrigger`
- `trigger`
- `decision_frame`
- `end`

Fill the rest with evenly spread frames through the clip so visual QA covers:
- before the shot
- around the shot
- after the shot

## Review Video Rules

`validation_review.mp4` must show:
- original ShotKam video on the top
- all available detection overlays on the top video, with bounding boxes linearly interpolated between stride frames for smooth tracking
- timestamp in milliseconds on the top-right
- audio waveform on the bottom
- labeled event markers on the waveform for:
  - trigger
  - pre-trigger clay location
  - break/miss decision frame

## Batch Summary

`batch_summary.csv` should include:
- filename
- status
- package path
- station prediction
- break label
- pre-trigger time in milliseconds

## Pass/Fail Checks

Each package generates a `validation_results.json`:

```json
{
  "status": "pass | review | fail",
  "checks": [
    { "name": "clay_detected_before_trigger", "status": "pass", "detail": "..." },
    { "name": "pretrigger_frame_has_clay", "status": "pass", "detail": "..." },
    { "name": "break_or_miss_detected", "status": "fail", "detail": "..." },
    ...
  ]
}
```

`batch_summary.csv` includes a `validation_status` column for quick triage.

Failure remediation:
- `clay_detected_before_trigger` fail -> lower clay threshold or check model coverage
- `pretrigger_frame_has_clay` fail -> adjust pretrigger timing or threshold
- `break_or_miss_detected` fail -> lower break/miss thresholds or retrain model
- `overlay_frame_alignment` fail -> IoU between pipeline boxes and fresh re-inference boxes is too low; check for frame seek issues, model non-determinism, or pipeline bugs
- `detection_continuity` warn -> consider lowering stride or investigating model gaps

## Usage Pattern

Use this package format for:
- model validation
- regression testing after CV changes
- overlay QA
- threshold tuning
- user review of borderline clips
