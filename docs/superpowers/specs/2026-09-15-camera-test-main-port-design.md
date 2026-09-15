# Camera Test Main Port Design

## Context

`webcam-test/react` is a standalone HTTPS Vite application for comparing the existing camera implementation with the camera preparation flow used by `ais-kyc.fe`.

The source baselines are:

- `webcam-test`: `main` at `63a68472`
- `ais-kyc.fe`: local `main` and `origin/main` at `e1cb24c7`

The target worktree already contains user-owned changes to `react/AGENTS.md` and a staged rename from `use_idcard_camera_stream.ts` to `useIdcardCameraStream.ts`, followed by removal of its default export. Those changes must be preserved.

## Goals

- Move the existing standalone camera implementation into `react/src/asis` without changing its behavior.
- Copy the current `ais-kyc.fe/main` camera permission, device selection, stream preparation, and validation implementation into `react/src/tobe`.
- Exclude Sentry modules and packages from the copied implementation.
- Provide one test page that switches between AS-IS and TO-BE modes and allows only one active stream.
- Expose enough state to diagnose permissions, device filtering, selected constraints, actual settings, capabilities, validation, and errors.
- Port the relevant automated tests to the Vite/Vitest environment.

## Non-goals

- Do not modify `ais-kyc.fe`.
- Do not copy OCR SDK, Next.js UI, Zustand stores, dialogs, or Sentry integration.
- Do not redesign the production camera policy.
- Do not run AS-IS and TO-BE streams simultaneously.
- Do not invent a camera service layer that does not exist at the source baseline.

## Chosen Approach

Use isolated `asis` and `tobe` namespaces with a shared test harness. This keeps both implementations independently inspectable and prevents shared abstractions from masking behavioral differences.

Only standalone integration changes are allowed in copied TO-BE files:

- Rewrite aliases/import paths so they resolve inside `src/tobe`.
- Remove the Sentry recorder import, recorder lifecycle, and Sentry observer wiring from `useIdcardCameraStream`; retain `recordVideoPlayFailure` as the current-stream/stale-stream guard and let the test panel display failures that the guard accepts.
- Keep the console diagnostic logger.
- Convert Jest test globals and mocks to Vitest imports and APIs.

All permission, filtering, resolution fallback, stream validation, stale-request protection, visibility recovery, track lifecycle, and browser-error mapping behavior must otherwise match the source baseline.

## File Layout

### AS-IS implementation

Move the existing implementation to:

```text
react/src/asis/
  hook/useCameraStream.ts
  lib/camera_utils.ts
  types/camera.ts
```

The files remain behaviorally unchanged except for relative imports required by the move.

### TO-BE implementation

Copy from `ais-kyc.fe/main` to:

```text
react/src/tobe/
  domain/camera/
    __tests__/
      idcard_camera_diagnostics.test.ts
      idcard_camera_policy.test.ts
      prepare_idcard_camera_stream.test.ts
    camera_errors.ts
    idcard_camera_diagnostics.ts
    idcard_camera_policy.ts
    prepare_idcard_camera_stream.ts
  infrastructure/camera/
    __tests__/
      idcard_camera_console_logger.test.ts
      media_devices_camera_gateway.test.ts
    idcard_camera_console_logger.ts
    media_devices_camera_gateway.ts
  lib/auth/types/camera.ts
  lib/hook/
    __tests__/useIdcardCameraStream.test.tsx
    useIdcardCameraStream.ts
```

No Sentry source or Sentry test file is copied.

### Test harness

The shared UI remains under `react/src` and is split into focused units where doing so reduces the existing `App.tsx` responsibilities:

```text
react/src/
  App.tsx
  App.css
  testbench/
    camera_test_types.ts
    camera_test_utils.ts
    CameraPanel.tsx
    AsIsCameraPanel.tsx
    ToBeCameraPanel.tsx
    __tests__/App.test.tsx
```

Camera behavior must not be reimplemented in `App.tsx`; it remains in the namespaced implementation or the explicitly diagnostic panel adapters.

## Runtime Architecture

`App` owns only the selected mode and runtime capability summary. It conditionally renders one panel, keyed by mode. Changing the mode unmounts the active panel before mounting the other panel.

Each panel owns its action state and delegates stream lifecycle to its implementation:

```text
AS-IS panel
  -> useCameraStream
    -> existing camera_utils
      -> navigator.mediaDevices

TO-BE panel
  -> useIdcardCameraStream
    -> PrepareIdcardCameraStream
      -> IdcardCameraPolicy
      -> MediaDevicesCameraGateway
        -> Permissions API / navigator.mediaDevices
```

The TO-BE panel may instantiate `IdcardCameraPolicy` and `MediaDevicesCameraGateway` for explicit diagnostic actions, but the production-style “rear camera start” action must use `useIdcardCameraStream.prepareStream`.

## Test Page Behavior

The mode selector offers AS-IS and TO-BE. Only the selected panel exists in the DOM.

Both modes provide:

- Request camera permission with `{ video: true, audio: false }`, then immediately stop the permission stream.
- Enumerate available video-input devices.
- Start the normal rear-camera flow.
- Play a manually selected device as a diagnostic action.
- Stop the active stream.
- Show requested constraints, selected device, stream summary, track settings, and track capabilities.
- Show secure-context and `getUserMedia` availability.

The TO-BE mode additionally provides:

- A `requireEnvironmentCamera` control, initially derived from the current user agent's mobile classification.
- A device-policy decision table containing facing assessment, pass/fail, and all decision reasons.
- Prepared result fields: `selectionReason`, `facingAssessment`, and `resolutionAttempt`.
- A stream-validation result produced by `IdcardCameraPolicy.validateStream`.

Manual device playback is explicitly labeled as a diagnostic bypass. It uses the TO-BE gateway to open the selected device and then runs the TO-BE policy validator; it is not presented as the production automatic-selection path.

## Stream Ownership and Cleanup

- A panel may own at most one stream.
- Starting another action stops the previous stream before requesting a new one.
- Permission bootstrap streams are always stopped in a `finally` path.
- Panel unmount and mode changes stop every track owned by that panel.
- The TO-BE hook retains its request token and stream identity checks so stale async results cannot replace a newer stream.
- `pagehide`, `pageshow`, visibility changes, and track lifecycle recovery remain the responsibility of the copied hooks.
- A `video.play()` rejection is reported only when it belongs to the currently attached stream.

## Error Handling

- AS-IS errors retain the existing `CameraError` mapping and message.
- TO-BE browser errors are mapped through `mapBrowserErrorToIdcardCameraError` and displayed with the domain error code.
- Buttons are disabled while their action is pending to prevent duplicate browser requests.
- A failed operation clears action loading state but preserves diagnostic request data.
- Partially created streams are stopped before an error is surfaced.
- Sentry capture and Sentry-specific buffering are absent; console diagnostics remain available.

## Automated Verification

Port these source tests from `ais-kyc.fe/main`:

- Camera error mapping and width/height overconstraint classification through the dependent usecase tests.
- Device facing assessment, exclusion rules, preference order, constraint construction, and stream validation.
- Permission bootstrap, device enumeration, strict-mobile behavior, desktop fallback behavior, preferred-to-fallback resolution retry, invalid stream rejection, and observer/logger isolation.
- MediaDevices gateway behavior, capability probing rules, and stream cleanup.
- Hook in-flight deduplication, stale result cleanup, unmount cleanup, visibility/BFCache recovery, track interruption recovery, and stale `video.play()` rejection handling.

Add test-harness component coverage for:

- Only the selected mode panel is rendered.
- Switching mode unmounts the previous panel and invokes stream cleanup.
- TO-BE rear-camera execution calls the copied hook path with the selected `requireEnvironmentCamera` value.
- TO-BE policy decisions and prepared/validation results are rendered.
- Sentry is not imported or required by the test project.

The verification commands are:

```bash
cd react
npm test -- --run
npm run lint
npm run build
```

After automated verification, run the HTTPS Vite server and manually confirm permission granted, permission denied, device enumeration, automatic rear-camera selection, direct selected-device playback, stream stop, and AS-IS/TO-BE mode cleanup on available desktop and mobile browsers.

## Acceptance Criteria

- Existing AS-IS camera source exists only under `react/src/asis` and behaves as before.
- The TO-BE core files correspond to `ais-kyc.fe` commit `e1cb24c7`, apart from documented import, Vitest, and Sentry-removal adaptations.
- No source file imports Sentry and no Sentry dependency is added.
- The page exposes permission, filtering, preparation, validation, settings, capabilities, and errors for the active mode.
- Changing mode or leaving the page stops the previous stream.
- Automated tests, lint, and production build pass.
- Existing user-owned worktree changes are preserved.
