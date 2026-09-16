# TOBE Mobile Camera Compatibility Design

## Goal

Fix the TOBE test page so a mobile rear-camera run does not fail only because `facingMode: exact` cannot be combined with an already selected exact `deviceId`, and so direct selected-device playback uses a current, permission-visible device identifier.

## Scope

- Modify only `/Users/useb70/Documents/workspace/webcam-test`.
- Do not modify `/Users/useb70/Documents/workspace/ais-kyc.fe`.
- Keep Sentry excluded.
- Keep the one-active-stream ownership rule.
- Preserve the user's uncommitted `react/AGENTS.md` change.
- Finish with local commits only; do not push or create a PR.

## Automatic rear-camera behavior

The TOBE policy keeps the selected mobile camera pinned with `deviceId: { exact: selectedDeviceId }`. It changes the redundant direction constraint to `facingMode: { ideal: "environment" }` for every candidate. Candidate filtering and final validation remain responsible for rejecting known or actual front-facing streams, rejecting a different selected device when the browser reports its ID, and enforcing the minimum resolution.

This reflects the browser boundary: an app-level `environment` assessment may come from capabilities or the camera label and does not prove that the browser can satisfy a required `facingMode` constraint together with a required `deviceId` constraint.

The copied TOBE exclusion policy is also synchronized with the current production source: `triple|트리플` labels are excluded and any camera with `zoom.min < 1` is treated as a wide-camera candidate.

## Direct selected-device behavior

`카메라 목록 조회` checks camera permission first. If permission is not already granted, it opens one unconstrained bootstrap stream, stops it, and only then enumerates devices. This exposes usable device identifiers without depending on `후면 카메라 실행`.

Before direct playback, TOBE re-enumerates without capability probe streams and verifies that the selected non-empty `deviceId` still exists. It opens that same ID with an exact device constraint. If the ID is stale, it does not substitute another camera; it reports that the list must be refreshed.

Blank device IDs remain visible in diagnostic information but are not selectable for direct playback.

## Verification

- Fail-first policy tests prove the selected mobile device uses exact `deviceId` plus ideal `facingMode`.
- Fail-first panel tests prove prompt permission is bootstrapped before enumeration, blank IDs are not playable, current selected IDs play exactly, and stale IDs do not open another camera.
- Existing ownership tests continue proving that bootstrap, automatic, probe, and manual streams never overlap.
- Run the complete unit suite, lint, focused TypeScript check, build, and source-boundary/Sentry checks before committing.
