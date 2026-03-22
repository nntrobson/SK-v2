---
name: shotkam-validation-package
description: Generate repeatable ShotKam computer-vision validation packages for one or more videos. Use when validating detection quality, checking overlays on clay videos, reviewing pre-trigger timing, producing screenshot packages, creating waveform-overlay review videos, or when the user asks to validate CV outputs on ShotKam clips.
---

# ShotKam Validation Package

## Purpose
Create a standard validation package for ShotKam-style videos so CV outputs can be reviewed visually and compared across runs.

## Package Standard
Each package should include:
- original video copy
- `extracted_data.csv` with per-frame and per-detection extracted data
- `manifest.json` with summary timings and artifact paths
- `screenshots/` with `15-20` overlaid screenshots spread through the clip
- `validation_review.mp4` with:
  - original video plus detection overlays on top
  - audio amplitude waveform on the bottom
  - timestamp in milliseconds on the top-right
  - waveform markers for:
    - trigger time
    - pre-trigger clay-location frame
    - break/miss decision frame

Required screenshot milestones:
- first frame where trap house is flagged
- pre-trigger frame used for clay position
- frame used for break vs miss decision
- additional spread frames before and after the shot

## Default Validation Clip

A reference clip is bundled at `fixtures/default_validation_clip.MP4` (original filename: `20240608125600SHOT0081.MP4`). Use this as the default for smoke tests and single-clip validation runs unless the user specifies a different file.

## Default Workflow
1. Confirm the video source folder and label CSV:
   - default video folder: `/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos`
   - default CSV: `/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/shots_data.csv`
   - default single-clip smoke test: `20240608125600SHOT0081.MP4`
2. Prefer a balanced sample across `Trap-house-1-2`, `Trap-house`, and `Trap-house-4-5` unless the user names exact files.
3. Run the generator script:

```bash
# Single-clip smoke test using the default validation clip
python3 scripts/generate_validation_packages.py --filenames 20240608125600SHOT0081.MP4 --frame-stride 5

# Balanced batch
python3 scripts/generate_validation_packages.py --sample-size 10 --frame-stride 5
```

Useful flags:

```bash
python3 scripts/generate_validation_packages.py --filenames FILE1.MP4 FILE2.MP4
python3 scripts/generate_validation_packages.py --output-root validation_packages
python3 scripts/generate_validation_packages.py --screenshot-count 18
```

4. Review the batch outputs:
   - `batch_summary.csv`
   - `batch_manifest.json`
   - package folders for each clip
5. Report:
   - package output directory
   - any failed videos
   - any obvious overlay or trigger-timing issues

## Operational Notes
- The script depends on Roboflow credentials. Prefer environment variables:
  - `ROBOFLOW_API_KEY`
  - `ROBOFLOW_PROJECT`
  - `ROBOFLOW_VERSION` (default: `19`; version 19 outperforms version 27 on break detection and continuity)
- If the user already provided credentials in chat, they may be passed via script flags for the current run, but should not be hardcoded into repo files.
- Use the generated screenshots and review video as the primary visual QA assets.
- Use `batch_summary.csv` as the quick index for a multi-video run.
- The review video uses linear interpolation for bounding boxes between stride frames so overlays track smoothly with the clay's motion.
- Frame caching ensures screenshots use the exact frames the model analyzed, avoiding OpenCV seek misalignment.

## Automated Pass/Fail Checks

Each package generates a `validation_results.json` with automated checks. The overall status is:
- **pass**: all checks pass
- **review**: some warnings but no hard failures
- **fail**: at least one check failed

### Check definitions

| Check | Type | Criteria |
|-------|------|----------|
| `clay_detected_before_trigger` | fail | >= 3 frames with clay-targets before trigger time |
| `pretrigger_frame_has_clay` | fail | The designated pretrigger frame must have a clay detection |
| `break_or_miss_detected` | fail | Break label must be `break` or `miss`, not `unknown` |
| `trap_house_detected` | warn | At least one frame has a trap-house class detection |
| `overlay_frame_alignment` | fail | Re-infer on 3 clay-visible cached frames; IoU between pipeline boxes and fresh boxes must be > 0.7 |
| `detection_continuity` | warn | Max gap between clay detections must be < 0.5s |

### Review workflow

1. Run the generator on clips.
2. Check `batch_summary.csv` for the `validation_status` column.
3. For any `fail` or `review` packages:
   - Open `validation_results.json` to see which checks failed.
   - Inspect the screenshots in `screenshots/` to visually verify.
   - Watch `validation_review.mp4` to confirm overlay alignment and audio timing.
4. Report findings: which clips passed, which failed, and what the failure mode was.

## References
- Package format and artifact expectations: [reference.md](reference.md)
