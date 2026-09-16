# TOBE Mobile Camera Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TOBE mobile automatic and direct selected-device camera playback compatible with browsers that reject redundant exact direction constraints or expose device IDs only after permission.

**Architecture:** Keep the production-shaped domain policy responsible for candidate selection and post-open validation, while using exact `deviceId` as the only required camera identity constraint. Keep permission bootstrap and current-device checks in the testbench adapter so the copied domain remains free of test-page UI state.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, MediaDevices API

**Spec:** `docs/superpowers/specs/2026-09-16-tobe-mobile-camera-compatibility-design.md`

## Global Constraints

- Modify only `/Users/useb70/Documents/workspace/webcam-test`; `/Users/useb70/Documents/workspace/ais-kyc.fe` is read-only.
- Exclude Sentry imports, packages, and runtime behavior.
- At most one live camera stream may exist at a time.
- Preserve the user's uncommitted `react/AGENTS.md` change and do not stage it.
- Keep direct playback exact to the selected current device; never silently substitute another camera.
- Create local commits only; do not push or create a PR.

---

### Task 1: Relax redundant mobile facing constraint and synchronize TOBE policy

**Files:**
- Modify: `react/src/tobe/domain/camera/idcard_camera_policy.ts:133-147,196-205`
- Modify: `react/src/tobe/domain/camera/__tests__/idcard_camera_policy.test.ts:154-166`
- Modify: `react/src/tobe/domain/camera/__tests__/prepare_idcard_camera_stream.test.ts`
- Modify: `react/src/testbench/__tests__/ToBeCameraPanel.test.tsx:279-302`
- Modify: `react/src/testbench/CameraPanel.tsx:405-418`

**Interfaces:**
- Consumes: `IdcardCameraPolicy.createMediaStreamConstraints(device, resolution, requireEnvironmentCamera)`.
- Produces: mobile constraints with `deviceId: { exact: device.deviceId }` and `facingMode: { ideal: "environment" }`, while keeping the existing return type.

- [ ] **Step 1: Change the policy expectations before implementation**

```ts
expect(policy.createMediaStreamConstraints(device, IDCARD_CAMERA_PREFERRED_RESOLUTION, true)).toEqual(
  expect.objectContaining({
    video: expect.objectContaining({
      facingMode: { ideal: "environment" },
      deviceId: { exact: "main" },
    }),
    audio: false,
  }),
);
```

Update integration assertions that currently expect `{ exact: "environment" }` so they require `{ ideal: "environment" }` while continuing to require an exact selected device.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `cd react && npx vitest run src/tobe/domain/camera/__tests__/idcard_camera_policy.test.ts src/tobe/domain/camera/__tests__/prepare_idcard_camera_stream.test.ts src/testbench/__tests__/ToBeCameraPanel.test.tsx`

Expected: the new facing expectations fail because the policy still creates an exact facing constraint; the existing triple/zoom tests also fail against the current working tree.

- [ ] **Step 3: Implement the minimal policy change and source synchronization**

```ts
const video: ExtendedMediaTrackConstraints = {
  width: { ideal: resolution.width, min: resolution.width },
  height: { ideal: resolution.height, min: resolution.height },
  facingMode: { ideal: this.preferredFacingMode },
  focusMode: { ideal: "continuous" },
  whiteBalanceMode: { ideal: "continuous" },
  zoom: { ideal: 1 },
};
```

Restore the current production exclusion expressions in the TOBE copy:

```ts
if (/ultra|울트라|wide|와이드|광각|tele|망원|triple|트리플/i.test(device.label)) {
  reasons.push("excluded_by_label");
}

if (typeof zoomMin === "number" && zoomMin < 1) {
  reasons.push("excluded_by_zoom_min");
}
```

Update the checkbox help text to state that the selected device is exact, rear direction is ideal, and the actual stream is validated afterward.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `cd react && npx vitest run src/tobe/domain/camera/__tests__/idcard_camera_policy.test.ts src/tobe/domain/camera/__tests__/prepare_idcard_camera_stream.test.ts src/testbench/__tests__/ToBeCameraPanel.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add react/src/tobe/domain/camera/idcard_camera_policy.ts react/src/tobe/domain/camera/__tests__/idcard_camera_policy.test.ts react/src/tobe/domain/camera/__tests__/prepare_idcard_camera_stream.test.ts react/src/testbench/__tests__/ToBeCameraPanel.test.tsx react/src/testbench/CameraPanel.tsx docs/superpowers/specs/2026-09-16-tobe-mobile-camera-compatibility-design.md docs/superpowers/plans/2026-09-16-tobe-mobile-camera-compatibility.md
git commit -m "fix: TOBE 모바일 후면 카메라 제약 호환"
```

### Task 2: Make direct selected-device playback permission-aware and current

**Files:**
- Modify: `react/src/testbench/ToBeCameraPanel.tsx:55-167`
- Modify: `react/src/testbench/CameraPanel.tsx:95-121,295-296,348-369`
- Modify: `react/src/testbench/__tests__/ToBeCameraPanel.test.tsx`
- Modify: `react/README.md:24-34`

**Interfaces:**
- Consumes: `MediaDevicesCameraGateway.queryPermission`, `requestPermission`, `enumerateVideoInputs`, `openStream`, and `stopStream`.
- Produces: unchanged `CameraPanelProps` callback signatures; direct playback internally verifies a current exact device before opening it.

- [ ] **Step 1: Add fail-first panel coverage**

Add tests with these externally visible assertions:

```ts
expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
expect(bootstrapTrack.stop).toHaveBeenCalledTimes(1);
expect(enumerateDevices).toHaveBeenCalledAfter(getUserMedia);
```

```ts
expect(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" })).toBeDisabled();
```

```ts
expect(getUserMedia).toHaveBeenLastCalledWith({
  video: expect.objectContaining({ deviceId: { exact: "back-main" } }),
  audio: false,
});
```

For a refreshed list that no longer contains the selected ID, assert that the alert asks for a new list lookup and that no exact request for the stale ID is issued.

- [ ] **Step 2: Run the panel tests and confirm RED**

Run: `cd react && npx vitest run src/testbench/__tests__/ToBeCameraPanel.test.tsx src/testbench/__tests__/App.test.tsx`

Expected: permission bootstrap ordering, blank-ID disabling, or stale-ID checks fail against the old adapter.

- [ ] **Step 3: Implement permission-aware enumeration**

Before enumeration, query permission. For `prompt`, acquire `{ video: true, audio: false }` and stop that bootstrap in `finally`. For `denied`, throw the existing `camera_permission_denied` domain error. Re-check operation ownership after each awaited browser call.

- [ ] **Step 4: Implement current exact-device validation**

Before direct open, enumerate with `{ probeCapabilities: false }`, find the same non-empty `deviceId`, and use that refreshed device for exact playback and validation. If it is absent, update TOBE's policy device state and throw a `camera_not_found` error whose message instructs the tester to reload the camera list.

In `CameraPanel`, build dropdown options only from devices with non-empty IDs and preserve a prior selection only while that exact ID still exists.

- [ ] **Step 5: Run the panel tests and confirm GREEN**

Run: `cd react && npx vitest run src/testbench/__tests__/ToBeCameraPanel.test.tsx src/testbench/__tests__/App.test.tsx`

Expected: all panel and mode-switch tests pass.

- [ ] **Step 6: Update manual test instructions**

Document that list lookup may request permission, direct playback rechecks the selected ID, and mobile strict mode pins the exact device while treating rear direction as ideal before post-open validation.

- [ ] **Step 7: Commit Task 2**

```bash
git add react/src/testbench/ToBeCameraPanel.tsx react/src/testbench/CameraPanel.tsx react/src/testbench/__tests__/ToBeCameraPanel.test.tsx react/src/testbench/__tests__/App.test.tsx react/README.md
git commit -m "fix: TOBE 선택 카메라 직접 재생 복구"
```

### Task 3: Verify the complete local result

**Files:**
- Verify only; do not modify `react/AGENTS.md`.

**Interfaces:**
- Consumes: Tasks 1 and 2 commits.
- Produces: verification evidence for the local handoff.

- [ ] **Step 1: Run all automated checks**

```bash
cd react
npm test -- --run
npm run lint
npx tsc -p tsconfig.testbench.json --noEmit
npm run build
```

Expected: every command exits zero.

- [ ] **Step 2: Verify boundaries and worktree state**

```bash
rg -n "@sentry|Sentry" src/tobe src/testbench package.json
git status --short
git diff HEAD -- react/AGENTS.md
```

Expected: no Sentry dependency was added, `ais-kyc.fe` remains unchanged, and only the user's existing `react/AGENTS.md` edit remains uncommitted.

- [ ] **Step 3: Review the committed diff**

Run a task review after each implementation task and a final whole-change review before reporting completion.
