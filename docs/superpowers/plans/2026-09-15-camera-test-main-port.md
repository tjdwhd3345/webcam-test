# Camera Test Main Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing webcam implementation under react/src/asis, port the Sentry-free camera flow from ais-kyc.fe/main into react/src/tobe, and expose both through a single-stream comparison page.

**Architecture:** App conditionally mounts one namespaced panel. The AS-IS panel delegates to the preserved useCameraStream; the TO-BE panel delegates production startup to the copied useIdcardCameraStream and uses copied policy/gateway objects only for explicit diagnostics. Every stream owner cleans up on replacement and unmount.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Testing Library, browser MediaDevices and Permissions APIs

**Spec:** docs/superpowers/specs/2026-09-15-camera-test-main-port-design.md

## Global Constraints

- Source baseline is ais-kyc.fe local main/origin/main commit e1cb24c7.
- Preserve the current react/AGENTS.md modification and named-export intent of the staged hook rename.
- Do not modify ais-kyc.fe.
- Do not copy or import Sentry code and do not add a Sentry package.
- Keep TO-BE permission, filtering, fallback, validation, stale-request, visibility, BFCache, and track-recovery behavior equal to the baseline except for aliases, Vitest conversion, and Sentry removal.
- Render one camera mode and own at most one active stream per mounted panel.
- Keep the Vite HTTPS configuration.
- Use path-scoped git commit --only commands so unrelated staged changes are excluded.

---

### Task 1: Isolate the AS-IS implementation

**Files:**

- Create: react/src/asis/__tests__/camera_modules.test.ts
- Move: react/src/hook/useCameraStream.ts → react/src/asis/hook/useCameraStream.ts
- Move: react/src/lib/camera_utils.ts → react/src/asis/lib/camera_utils.ts
- Move: react/src/types/camera.ts → react/src/asis/types/camera.ts
- Modify: react/src/App.tsx
- Modify: react/vite.config.ts
- Modify: react/vitest.config.ts
- Modify: react/tsconfig.app.json

**Interfaces:**

- Consumes: useCameraStream(initialOptions?: CameraStreamOptions): UseCameraStreamReturn
- Produces: @asis/hook/useCameraStream, @asis/lib/camera_utils, and @asis/types/camera

- [ ] **Step 1: Write the failing namespace test**

Create react/src/asis/__tests__/camera_modules.test.ts with dynamic imports so the missing namespace is an assertion failure rather than a collection error:

~~~ts
import { describe, expect, it } from "vitest";

describe("AS-IS 카메라 모듈 경계", () => {
  it("권한 거부 오류를 namespaced utility에서 기존 오류로 변환한다", async () => {
    const { mapBrowserErrorToCameraError } = await import("../lib/camera_utils");
    const error = new Error("denied");
    error.name = "NotAllowedError";

    expect(mapBrowserErrorToCameraError(error)).toMatchObject({
      type: "NotAllowedError",
      message: "카메라 사용 권한이 거부되었습니다.",
      originalError: error,
    });
  });
});
~~~

- [ ] **Step 2: Run the test and confirm RED**

Run: cd react && npx vitest run src/asis/__tests__/camera_modules.test.ts

Expected: FAIL because the namespaced modules do not exist.

- [ ] **Step 3: Move the files and repair only their relative imports**

Keep the hook imports pointed to ../types/camera and ../lib/camera_utils. Keep the utility type import pointed to ../types/camera. Update App imports to:

~~~ts
import { useCameraStream } from "@asis/hook/useCameraStream";
import type { CameraDeviceInfo, CameraFacingMode, CameraStreamOptions } from "@asis/types/camera";
~~~

Add the @asis alias to Vite, Vitest, and TypeScript in this task. Retain all existing aliases; Task 2 will add @tobe.

- [ ] **Step 4: Verify GREEN and build compatibility**

Run: cd react && npx vitest run src/asis/__tests__/camera_modules.test.ts

Expected: PASS.

Run: cd react && npm run build

Expected: PASS and the existing AS-IS UI remains functional.

- [ ] **Step 5: Commit this task only**

~~~bash
git commit --only react/src/asis react/src/hook/useCameraStream.ts react/src/lib/camera_utils.ts react/src/types/camera.ts react/src/App.tsx react/vite.config.ts react/vitest.config.ts react/tsconfig.app.json -m "feature: AS-IS 카메라 구현 분리"
~~~

---

### Task 2: Port the TO-BE domain and browser gateway

**Files:**

- Create: react/src/tobe/lib/auth/types/camera.ts
- Create: react/src/tobe/domain/camera/camera_errors.ts
- Create: react/src/tobe/domain/camera/idcard_camera_diagnostics.ts
- Create: react/src/tobe/domain/camera/idcard_camera_policy.ts
- Create: react/src/tobe/domain/camera/prepare_idcard_camera_stream.ts
- Create: react/src/tobe/infrastructure/camera/idcard_camera_console_logger.ts
- Create: react/src/tobe/infrastructure/camera/media_devices_camera_gateway.ts
- Create: tests beside each copied domain and infrastructure module
- Modify: react/vite.config.ts
- Modify: react/vitest.config.ts
- Modify: react/tsconfig.app.json
- Modify: react/src/App.tsx
- Remove after replacement: preliminary root-level domain/camera, infrastructure/camera, and lib/auth camera files

**Interfaces:**

- Produces: IdcardCameraPolicy, IdcardCameraError, PrepareIdcardCameraStream, MediaDevicesCameraGateway, idcardCameraConsoleLogger
- Produces: PrepareIdcardCameraStream.execute(input, attemptToken?): Promise<PreparedIdcardCameraStreamResult>
- Produces: IdcardCameraPolicy.evaluateVideoInputDevices(devices, requireEnvironmentCamera?): IdcardCameraDeviceSelectionDecision[]

- [ ] **Step 1: Add a failing main-baseline behavior to the current policy test**

Import describe, expect, and it from Vitest in the existing policy test. Add the camera-label priority behavior already present in the source baseline:

~~~ts
it("camera N, facing back 후보는 열거 순서와 관계없이 숫자가 낮은 카메라를 우선 선택한다", () => {
  const devices: CameraDeviceInfo[] = [
    { deviceId: "back-0", label: "camera 0, facing back", facingMode: "environment" },
    { deviceId: "back-2", label: "camera 2, facing back", facingMode: "environment" },
  ];

  expect(policy.selectPreferredDevice(devices)).toEqual({
    deviceId: "back-0",
    label: "camera 0, facing back",
    facingMode: "environment",
  });
});
~~~

- [ ] **Step 2: Run that behavior and confirm RED**

Run: cd react && npx vitest run src/domain/camera/__tests__/idcard_camera_policy.test.ts -t "camera N, facing back"

Expected: FAIL because the preliminary policy falls back to reverse enumeration order and selects back-2.

- [ ] **Step 3: Copy and adapt the baseline tests before replacing production files**

Use the exact tests at commit e1cb24c7:

~~~text
src/domain/camera/__tests__/idcard_camera_diagnostics.test.ts
src/domain/camera/__tests__/idcard_camera_policy.test.ts
src/domain/camera/__tests__/prepare_idcard_camera_stream.test.ts
src/infrastructure/camera/__tests__/idcard_camera_console_logger.test.ts
src/infrastructure/camera/__tests__/media_devices_camera_gateway.test.ts
~~~

Convert test APIs with these exact rules:

~~~ts
import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

// jest.fn -> vi.fn
// jest.spyOn -> vi.spyOn
// jest.mocked -> vi.mocked
// jest.Mocked<T> -> Mocked<T>
~~~

Rewrite @lib/auth/types/camera to @tobe/lib/auth/types/camera, @/domain/camera to @tobe/domain/camera, and @/infrastructure/camera to @tobe/infrastructure/camera. Import vi and Mocked only where used.

- [ ] **Step 4: Add the TO-BE alias to all three resolvers**

Retain the @asis alias from Task 1 and add @tobe to vite.config.ts and vitest.config.ts with fileURLToPath(new URL("./src/tobe", import.meta.url)).

Set tsconfig.app.json paths to:

~~~json
{
  "@/*": ["src/*"],
  "@asis/*": ["src/asis/*"],
  "@tobe/*": ["src/tobe/*"]
}
~~~

- [ ] **Step 5: Copy the seven baseline production files**

Copy exact content from ais-kyc.fe at e1cb24c7. Rewrite only namespace aliases:

~~~ts
import type { CameraDeviceInfo, CameraFacingMode } from "@tobe/lib/auth/types/camera";
import type { IdcardCameraDiagnosticLogger } from "@tobe/domain/camera/idcard_camera_diagnostics";
import type { IdcardCameraGateway } from "@tobe/domain/camera/prepare_idcard_camera_stream";
~~~

Keep relative imports inside tobe/domain/camera. Update temporary App TO-BE imports to @tobe. Remove preliminary root-level TO-BE files only after their replacements compile.

- [ ] **Step 6: Verify core GREEN**

Run: cd react && npx vitest run src/tobe/domain/camera/__tests__ src/tobe/infrastructure/camera/__tests__

Expected: all baseline core tests PASS.

Run: cd react && npm run build

Expected: PASS.

- [ ] **Step 7: Commit this task only**

~~~bash
git commit --only react/src/tobe/domain react/src/tobe/infrastructure react/src/tobe/lib/auth react/src/domain react/src/infrastructure react/src/lib/auth react/src/App.tsx react/vite.config.ts react/vitest.config.ts react/tsconfig.app.json -m "feature: TO-BE 카메라 코어 이식"
~~~

---

### Task 3: Port the TO-BE React hook without Sentry

**Files:**

- Create: react/src/tobe/lib/hook/useIdcardCameraStream.ts
- Create: react/src/tobe/lib/hook/__tests__/useIdcardCameraStream.test.tsx
- Remove after replacement: react/src/lib/hook/useIdcardCameraStream.ts

**Interfaces:**

- Consumes: PrepareIdcardCameraStream, MediaDevicesCameraGateway, idcardCameraConsoleLogger
- Produces: useIdcardCameraStream with stream, loading, error, selected-device, settings, resolution, prepareStream, recordVideoPlayFailure, and stopStream
- Produces: recordVideoPlayFailure(error, failedStream?): boolean, where true means the failure belongs to the current prepared stream

- [ ] **Step 1: Create Sentry-free hook tests first**

Start from the baseline hook test and convert Jest to Vitest and imports to @tobe. Load the production hook with `await import("../useIdcardCameraStream")` inside the tests (or a shared async loader called by them) so the first RED run reports a rejected test at the missing module boundary instead of aborting test collection. Remove Sentry mocks and recorder-only assertions. Retain tests for lazy gateway/usecase creation, successful preparation, stop cleanup, in-flight deduplication, current/stale play-failure identification, unmount cleanup, error state, pagehide/pageshow recovery, hidden track recovery, and no recovery after explicit stop.

Use this public play-failure contract:

~~~ts
expect(result.current.recordVideoPlayFailure(new Error("play failed"), currentStream)).toBe(true);
expect(result.current.recordVideoPlayFailure(new Error("stale"), staleStream)).toBe(false);

act(() => result.current.stopStream());
expect(result.current.recordVideoPlayFailure(new Error("stopped"), currentStream)).toBe(false);
~~~

- [ ] **Step 2: Confirm the hook test is RED**

Run: cd react && npx vitest run src/tobe/lib/hook/__tests__/useIdcardCameraStream.test.tsx

Expected: FAIL inside the test because the dynamic import cannot resolve the namespaced hook; the test file itself must still collect successfully.

- [ ] **Step 3: Copy the hook and remove only Sentry behavior**

Remove createIdcardCameraSentryRecorder, recorderRef, beginAttempt, endAttempt, and recorder delivery. Construct dependencies as:

~~~ts
const gatewayRef = useRef<MediaDevicesCameraGateway | null>(null);
if (!gatewayRef.current) gatewayRef.current = new MediaDevicesCameraGateway(undefined, idcardCameraConsoleLogger);

const usecaseRef = useRef<PrepareIdcardCameraStream | null>(null);
if (!usecaseRef.current) {
  usecaseRef.current = new PrepareIdcardCameraStream(
    gatewayRef.current,
    undefined,
    undefined,
    idcardCameraConsoleLogger,
  );
}
~~~

Use PreparedStreamAttempt with only input, call execute(input), and retain the stale guard:

~~~ts
const recordVideoPlayFailure = useCallback((_error: unknown, failedStream?: MediaStream) => {
  const currentStream = streamRef.current;
  const lastPrepareInput = lastPrepareInputRef.current;
  if (!currentStream || !lastPrepareInput) return false;

  const reportedStream = failedStream ?? currentStream;
  if (reportedStream !== currentStream) return false;

  const attempt = streamAttemptsRef.current?.get(reportedStream);
  if (!attempt || attempt.input !== lastPrepareInput) return false;

  return true;
}, []);
~~~

Use @tobe aliases, retain the named export, and do not add a default export.

- [ ] **Step 4: Verify hook and core GREEN**

Run: cd react && npx vitest run src/tobe/lib/hook/__tests__/useIdcardCameraStream.test.tsx src/tobe/domain/camera/__tests__ src/tobe/infrastructure/camera/__tests__

Expected: PASS with no Sentry module resolution.

- [ ] **Step 5: Commit this task only**

~~~bash
git commit --only react/src/tobe/lib/hook react/src/lib/hook/useIdcardCameraStream.ts react/src/lib/hook/use_idcard_camera_stream.ts -m "feature: Sentry 없는 TO-BE 카메라 훅 이식"
~~~

---

### Task 4: Extract the shared testbench and AS-IS panel

**Files:**

- Create: react/src/testbench/camera_test_types.ts
- Create: react/src/testbench/camera_test_utils.ts
- Create: react/src/testbench/CameraPanel.tsx
- Create: react/src/testbench/AsIsCameraPanel.tsx
- Create: react/src/testbench/__tests__/AsIsCameraPanel.test.tsx
- Create: react/src/test/setup.ts
- Modify: react/vitest.config.ts
- Modify: react/src/App.tsx

**Interfaces:**

- Produces: WorkbenchMode, RawMediaDevice, StreamSnapshot, CameraPolicyDecisionView
- Produces: requestCameraPermission(): Promise<PermissionState | "unknown">
- Produces: loadAllMediaDevices(): Promise<RawMediaDevice[]>
- Produces: getStreamSnapshot(stream): StreamSnapshot
- Produces: presentation-only CameraPanel callbacks for permission, enumeration, automatic start, manual-device start, and stop

- [ ] **Step 1: Write the failing AS-IS panel test**

Render AsIsCameraPanel with the real AS-IS hook. Replace only navigator.mediaDevices and navigator.permissions, because those are the external browser boundary. Make getUserMedia return a complete fake MediaStream whose live video track has 1920×1080 settings. Click 후면 카메라 실행 and assert the rendered status changes to playing with 1920x1080. Also assert the final external getUserMedia request contains the constraints derived from the AS-IS hook options:

~~~tsx
expect(getUserMedia).toHaveBeenLastCalledWith({
  video: expect.objectContaining({
    facingMode: { ideal: "environment" },
    width: { ideal: 1920, min: 1920 },
    height: { ideal: 1080, min: 1080 },
  }),
  audio: false,
});
~~~

Click 정지 and assert the fake track's stop method was called and the rendered status changes to stopped.

- [ ] **Step 2: Confirm RED**

Run: cd react && npx vitest run src/testbench/__tests__/AsIsCameraPanel.test.tsx

Expected: FAIL because AsIsCameraPanel does not exist.

- [ ] **Step 3: Extract generic browser/test-page utilities**

Define the shared types explicitly:

~~~ts
export type WorkbenchMode = "as-is" | "to-be";

export interface RawMediaDevice {
  deviceId: string;
  groupId: string;
  kind: MediaDeviceKind;
  label: string;
  facingMode?: "user" | "environment";
  capabilities?: MediaTrackCapabilities;
}

export interface StreamSnapshot {
  active: boolean;
  id?: string;
  tracks: Array<{
    id: string;
    kind: string;
    label: string;
    enabled: boolean;
    muted: boolean;
    readyState: MediaStreamTrackState;
    settings: MediaTrackSettings;
    capabilities?: MediaTrackCapabilities;
  }>;
}

export interface CameraPolicyDecisionView {
  device: RawMediaDevice;
  facingAssessment: "environment" | "user" | "unknown";
  passed: boolean;
  reasons: string[];
}
~~~

Export these exact signatures from camera_test_utils.ts:

~~~ts
export const getMediaDevices = (): MediaDevices;
export const stopMediaStream = (stream: MediaStream | null | undefined): void;
export const requestCameraPermission = async (): Promise<PermissionState | "unknown">;
export const loadAllMediaDevices = async (): Promise<RawMediaDevice[]>;
export const getVideoInputDevices = (devices: RawMediaDevice[]): RawMediaDevice[];
export const getRuntimeCapabilities = (): { isSecureContext: boolean; getUserMedia: boolean };
export const getStreamSnapshot = (stream: MediaStream | null): StreamSnapshot;
export const toErrorMessage = (error: unknown): string;
export const toExactDeviceConstraints = (device: RawMediaDevice): MediaStreamConstraints;
~~~

requestCameraPermission must stop the bootstrap stream before permission-state lookup.

Create react/src/test/setup.ts with `import "@testing-library/jest-dom/vitest";` and set Vitest `test.setupFiles` to `"./src/test/setup.ts"`.

- [ ] **Step 4: Extract presentation and AS-IS adaptation**

CameraPanel owns action/loading state, device selection, video attachment, and JSON/status rendering. It must not import either camera namespace.

AsIsCameraPanel uses the preserved hook and these exact options:

~~~ts
const IDCARD_CAMERA_OPTIONS: CameraStreamOptions = {
  video: {
    facingMode: "environment",
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    focusMode: "continuous",
    whiteBalanceMode: "continuous",
    zoom: { ideal: 1 },
  },
  audio: false,
  retryCount: 3,
  retryDelay: 1000,
};
~~~

Automatic and manual starts call useCameraStream.startStream; stop calls useCameraStream.stopStream. App renders this component for AS-IS.

- [ ] **Step 5: Verify GREEN and build**

Run: cd react && npx vitest run src/testbench/__tests__/AsIsCameraPanel.test.tsx src/asis/__tests__/camera_modules.test.ts

Expected: PASS.

Run: cd react && npm run build

Expected: PASS.

- [ ] **Step 6: Commit this task only**

~~~bash
git commit --only react/src/testbench/camera_test_types.ts react/src/testbench/camera_test_utils.ts react/src/testbench/CameraPanel.tsx react/src/testbench/AsIsCameraPanel.tsx react/src/testbench/__tests__/AsIsCameraPanel.test.tsx react/src/test/setup.ts react/vitest.config.ts react/src/App.tsx -m "feature: AS-IS 카메라 테스트 패널 구성"
~~~

---

### Task 5: Wire TO-BE diagnostics and the single-stream mode switch

**Files:**

- Create: react/src/testbench/ToBeCameraPanel.tsx
- Create: react/src/testbench/__tests__/ToBeCameraPanel.test.tsx
- Create: react/src/testbench/__tests__/App.test.tsx
- Modify: react/src/testbench/CameraPanel.tsx
- Modify: react/src/testbench/camera_test_types.ts
- Modify: react/src/App.tsx
- Modify: react/src/App.css
- Modify: react/README.md

**Interfaces:**

- Consumes: useIdcardCameraStream, IdcardCameraPolicy, MediaDevicesCameraGateway
- Produces: strict-mobile control, policy decisions, production result, manual validation, and accepted video.play failure display
- Produces: App mode switch where exactly one panel is mounted

- [ ] **Step 1: Write failing TO-BE tests**

Use the real copied hook, usecase, policy, and gateway. Replace only navigator.permissions and navigator.mediaDevices with complete browser-boundary fakes. After selecting 모바일 후면 카메라 강제 and clicking 후면 카메라 실행, assert the rendered preparation details contain verified_environment, environment, preferred, and a valid stream. Also assert the final external getUserMedia request contains the strict constraints:

~~~ts
expect(getUserMedia).toHaveBeenLastCalledWith({
  video: expect.objectContaining({
    deviceId: { exact: "back-main" },
    facingMode: { exact: "environment" },
  }),
  audio: false,
});
~~~

Enumerate a normal environment camera and Back Ultra Wide Camera; assert the page renders verified_environment and excluded_by_label. Unmount after a manually opened stream and assert hook.stopStream plus gateway stream cleanup.

- [ ] **Step 2: Write the failing App mode test**

~~~tsx
it("선택한 모드의 패널만 mount한다", async () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "AS-IS" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "TO-BE" })).not.toBeInTheDocument();

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "테스트 방식" }),
    "to-be",
  );

  expect(screen.queryByRole("heading", { name: "AS-IS" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "TO-BE" })).toBeInTheDocument();
});
~~~

- [ ] **Step 3: Confirm both tests are RED**

Run: cd react && npx vitest run src/testbench/__tests__/ToBeCameraPanel.test.tsx src/testbench/__tests__/App.test.tsx

Expected: FAIL because final TO-BE composition does not exist.

- [ ] **Step 4: Implement production-style TO-BE startup**

Call:

~~~ts
const result = await camera.prepareStream({
  target: "idcard_front",
  requireEnvironmentCamera,
});

setPreparationDetails({
  selectionReason: result.selectionReason,
  facingAssessment: result.facingAssessment,
  resolutionAttempt: result.resolutionAttempt,
  validation: policy.validateStream(result.stream, {
    devices,
    requestedDevice: result.selectedDevice,
    requireEnvironmentCamera,
  }),
});
~~~

Initialize requireEnvironmentCamera with `/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent)` and expose a checkbox named 모바일 후면 카메라 강제.

Enumeration calls gateway.enumerateVideoInputs({ probeCapabilities: !requireEnvironmentCamera }) and renders policy.evaluateVideoInputDevices(devices, requireEnvironmentCamera).

Manual playback first calls camera.stopStream, stops its prior manual stream, then calls gateway.openStream with exact device constraints and validates with policy.validateStream. Label it 선택 장치 직접 재생 (진단).

On video.play rejection, call camera.recordVideoPlayFailure(error, stream). Display an automatic-stream rejection only when the guard returns true. Display direct manual-stream failures through the panel error path.

- [ ] **Step 5: Reduce App to mode composition**

App owns mode state and runtime status. It renders:

~~~tsx
{activeMode === "as-is" ? (
  <AsIsCameraPanel key="as-is" />
) : (
  <ToBeCameraPanel key="to-be" />
)}
~~~

Keep the existing visual language. Add CSS only for the strict-mode control, decision table, pass/fail badges, and validation result. Update README with HTTPS startup, both modes, source commit e1cb24c7, Sentry exclusion, and the manual test sequence.

- [ ] **Step 6: Verify GREEN, full tests, and build**

Run: cd react && npx vitest run src/testbench/__tests__

Expected: PASS.

Run: cd react && npm test -- --run

Expected: PASS.

Run: cd react && npm run build

Expected: PASS.

- [ ] **Step 7: Commit this task only**

~~~bash
git commit --only react/src/App.tsx react/src/App.css react/src/testbench react/README.md -m "feature: TO-BE 카메라 검증 페이지 구성"
~~~

---

### Task 6: Verify source fidelity and quality gates

**Files:**

- Verify: react/src/asis, react/src/tobe, react/src/testbench
- Modify only when a verification failure identifies an in-scope defect

**Interfaces:**

- Consumes: Tasks 1–5
- Produces: evidence that the port is Sentry-free, namespaced, tested, lint-clean, buildable, and single-stream

- [ ] **Step 1: Verify boundaries and Sentry exclusion**

Run:

~~~bash
cd react
rg --files src/asis src/tobe src/testbench | sort
rg -n "@sentry|Sentry|idcard_camera_sentry" src/tobe src/testbench
~~~

Expected: designed paths are listed; the Sentry search has no matches.

- [ ] **Step 2: Compare TO-BE production files with e1cb24c7**

Diff every TO-BE production file against its ais-kyc.fe counterpart. Expected differences are limited to @tobe imports and documented hook Sentry removal. Investigate and correct any other difference before continuing.

- [ ] **Step 3: Run quality gates**

Run:

~~~bash
cd react
npm test -- --run
npm run lint
npm run build
~~~

Expected: every command exits 0 with no test failures, ESLint errors, or build errors.

- [ ] **Step 4: Run HTTPS browser smoke checks**

Run: cd react && npm run dev -- --host 127.0.0.1

Verify permission bootstrap cleanup, AS-IS automatic/manual streaming, TO-BE policy decisions, TO-BE automatic result/validation, TO-BE manual diagnostic validation, explicit stop, denial errors, and track cleanup across both mode changes.

- [ ] **Step 5: Inspect final ownership and diff**

Run:

~~~bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
~~~

Expected: only scoped implementation commits plus the pre-existing react/AGENTS.md modification remain; generated dist and dependency artifacts are unchanged.
