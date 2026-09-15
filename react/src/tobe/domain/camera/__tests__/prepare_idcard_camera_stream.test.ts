import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { IdcardCameraError } from "../camera_errors";
import type { IdcardCameraDiagnosticEvent, IdcardCameraDiagnosticLogger } from "../idcard_camera_diagnostics";
import { maskCameraDeviceId } from "../idcard_camera_diagnostics";
import type { IdcardCameraGateway, IdcardCameraPreparationEvent, IdcardCameraPreparationObserver } from "../prepare_idcard_camera_stream";
import { PrepareIdcardCameraStream } from "../prepare_idcard_camera_stream";

type MockGateway = Mocked<IdcardCameraGateway>;

const createStream = (settings: MediaTrackSettings, readyState: MediaStreamTrackState = "live") => {
  const track = {
    readyState,
    getSettings: vi.fn(() => settings),
  } as unknown as MediaStreamTrack;

  return {
    getTracks: vi.fn(() => [track]),
    getVideoTracks: vi.fn(() => [track]),
  } as unknown as MediaStream;
};

const createConstraintError = (name: "OverconstrainedError" | "ConstraintNotSatisfiedError", constraint: string, property: "constraint" | "constraintName" = "constraint") => {
  const error = new Error(`${name}: ${constraint}`) as Error & { constraint?: string; constraintName?: string };
  error.name = name;
  error[property] = constraint;
  return error;
};

const defaultPermissionStream = () => createStream({ deviceId: "main", facingMode: "environment", width: 640, height: 480 });
const defaultDevices = (): CameraDeviceInfo[] => [{ deviceId: "main", label: "Back Camera", facingMode: "environment" }];
const createOpenStreamMock = (stream: MediaStream) => vi.fn<Promise<MediaStream>, [MediaStreamConstraints]>(() => Promise.resolve(stream));
const createEnumerateVideoInputsMock = (devices: CameraDeviceInfo[]) =>
  vi.fn<Promise<CameraDeviceInfo[]>, [Parameters<IdcardCameraGateway["enumerateVideoInputs"]>[0]]>(() => Promise.resolve(devices));

const createGateway = (overrides: Partial<MockGateway> = {}): MockGateway => ({
  isSupported: vi.fn(() => true),
  queryPermission: vi.fn(() => Promise.resolve("prompt")),
  requestPermission: vi.fn<Promise<MediaStream>, [MediaStreamConstraints?]>(() => Promise.resolve(defaultPermissionStream())),
  enumerateVideoInputs: createEnumerateVideoInputsMock(defaultDevices()),
  openStream: vi.fn<Promise<MediaStream>, [MediaStreamConstraints]>(() => Promise.resolve(createStream({ deviceId: "main", facingMode: "environment", width: 1920, height: 1080 }))),
  stopStream: vi.fn(),
  ...overrides,
});

const createObserver = () => {
  const events: IdcardCameraPreparationEvent[] = [];
  const observer: IdcardCameraPreparationObserver = (event) => events.push(event);
  return { events, observer };
};

const createDiagnosticLogger = () => {
  const events: IdcardCameraDiagnosticEvent[] = [];
  const diagnosticLogger: IdcardCameraDiagnosticLogger = (channel, payload) => events.push({ channel, payload });
  return { diagnosticLogger, events };
};

const createUsecase = (gateway: MockGateway, observer?: IdcardCameraPreparationObserver, diagnosticLogger?: IdcardCameraDiagnosticLogger) =>
  new PrepareIdcardCameraStream(gateway, undefined, observer, diagnosticLogger);

describe("PrepareIdcardCameraStream", () => {
  it("MediaDevices 미지원이면 실패한다", async () => {
    const gateway = createGateway({ isSupported: vi.fn(() => false) });
    const usecase = createUsecase(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({ code: "media_devices_not_supported" });
    expect(gateway.queryPermission).not.toHaveBeenCalled();
  });

  it("권한 조회가 denied면 checked와 query denied를 알리고 권한 요청 없이 실패한다", async () => {
    const gateway = createGateway({ queryPermission: vi.fn(() => Promise.resolve("denied")) });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_permission_denied" });
    expect(gateway.requestPermission).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "permission_checked", permissionState: "denied", target: "idcard_front", requireEnvironmentCamera: true },
      { type: "permission_denied", source: "query", target: "idcard_front", requireEnvironmentCamera: true },
    ]);
  });

  it("모바일 권한 요청은 장치를 제한하지 않고 승인 스트림을 항상 종료한다", async () => {
    const permissionStream = defaultPermissionStream();
    const finalStream = createStream({ deviceId: "main", facingMode: "environment", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(permissionStream)),
      openStream: createOpenStreamMock(finalStream),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    const result = await usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true });

    const permissionConstraints = { video: true, audio: false };
    expect(gateway.requestPermission).toHaveBeenCalledWith(permissionConstraints);
    expect(gateway.stopStream).toHaveBeenCalledWith(permissionStream);
    expect(gateway.stopStream.mock.invocationCallOrder[0]).toBeLessThan(gateway.enumerateVideoInputs.mock.invocationCallOrder[0]);
    expect(gateway.enumerateVideoInputs.mock.invocationCallOrder[0]).toBeLessThan(gateway.openStream.mock.invocationCallOrder[0]);
    expect(result.stream).toBe(finalStream);
    expect(result.stream).not.toBe(permissionStream);
    expect(events.map((event) => event.type)).toEqual(["permission_checked", "permission_requested", "permission_granted", "device_selected"]);
    expect(events[1]).toEqual({ type: "permission_requested", constraints: permissionConstraints, target: "idcard_front", requireEnvironmentCamera: true });
    expect(events[2]).toEqual({
      type: "permission_granted",
      settings: { deviceId: "main", facingMode: "environment", width: 640, height: 480 },
      facingAssessment: "environment",
      target: "idcard_front",
      requireEnvironmentCamera: true,
    });
  });

  it("호출자가 전달한 attempt token을 모든 observer 이벤트에 보존한다", async () => {
    const gateway = createGateway();
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true }, 17);

    expect(events.map((event) => event.attemptToken)).toEqual([17, 17, 17, 17]);
  });

  it("권한 요청 거부는 request 출처와 errorName만 알린다", async () => {
    const denied = new Error("secret browser message");
    denied.name = "NotAllowedError";
    const gateway = createGateway({ requestPermission: vi.fn().mockRejectedValue(denied) });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_back", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_permission_denied" });

    expect(events).toEqual([
      { type: "permission_checked", permissionState: "prompt", target: "idcard_back", requireEnvironmentCamera: true },
      {
        type: "permission_requested",
        constraints: { video: true, audio: false },
        target: "idcard_back",
        requireEnvironmentCamera: true,
      },
      { type: "permission_denied", source: "request", errorName: "NotAllowedError", target: "idcard_back", requireEnvironmentCamera: true },
    ]);
    expect(gateway.enumerateVideoInputs).not.toHaveBeenCalled();
  });

  it("모바일 권한 스트림이 user로 확인되어도 종료한 뒤 후면 장치 선별을 계속한다", async () => {
    const permissionStream = createStream({ deviceId: "front", facingMode: "user", width: 640, height: 480 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(permissionStream)),
      enumerateVideoInputs: createEnumerateVideoInputsMock([
        { deviceId: "front", label: "Front Camera", facingMode: "user" },
        { deviceId: "back", label: "Back Camera", facingMode: "environment" },
      ]),
      openStream: createOpenStreamMock(createStream({ deviceId: "back", facingMode: "environment", width: 1920, height: 1080 })),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).resolves.toMatchObject({
      selectedDevice: { deviceId: "back" },
      facingAssessment: "environment",
    });

    expect(gateway.stopStream).toHaveBeenCalledWith(permissionStream);
    expect(gateway.enumerateVideoInputs).toHaveBeenCalledWith({ probeCapabilities: false });
    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: "back" } }) }));
    expect(events).toContainEqual({
      type: "front_facing_detected",
      stage: "permission",
      detectionSource: "track_settings",
      facingAssessment: "user",
      constraints: { video: true, audio: false },
      settings: { deviceId: "front", facingMode: "user", width: 640, height: 480 },
      target: "idcard_front",
      requireEnvironmentCamera: true,
    });
  });

  it("권한 settings가 unknown이고 deviceId가 user 장치여도 후면 장치 선별을 계속한다", async () => {
    const permissionStream = createStream({ deviceId: "front", width: 640, height: 480 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(permissionStream)),
      enumerateVideoInputs: createEnumerateVideoInputsMock([
        { deviceId: "front", label: "Front Camera", facingMode: "user" },
        { deviceId: "back", label: "Back Camera", facingMode: "environment" },
      ]),
      openStream: createOpenStreamMock(createStream({ deviceId: "back", facingMode: "environment", width: 1920, height: 1080 })),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).resolves.toMatchObject({
      selectedDevice: { deviceId: "back" },
      facingAssessment: "environment",
    });

    expect(gateway.stopStream).toHaveBeenCalledWith(permissionStream);
    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: "back" } }) }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "front_facing_detected",
        stage: "permission",
        detectionSource: "enumerated_device",
        facingAssessment: "user",
        constraints: { video: true, audio: false },
      }),
    );
  });

  it("모바일은 방향 판별 불가 장치를 호환성 예외로 허용한다", async () => {
    const permissionStream = createStream({ deviceId: "unknown", width: 640, height: 480 });
    const finalStream = createStream({ deviceId: "unknown", width: 1920, height: 1080 });
    const unknownDevice: CameraDeviceInfo = {
      deviceId: "unknown",
      label: "FaceTime HD 카메라",
      capabilities: {
        width: { min: 1, max: 1920 },
        height: { min: 1, max: 1920 },
      } as MediaTrackCapabilities,
    };
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(permissionStream)),
      enumerateVideoInputs: createEnumerateVideoInputsMock([unknownDevice]),
      openStream: createOpenStreamMock(finalStream),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    const result = await usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true });

    expect(result).toEqual({
      stream: finalStream,
      selectedDevice: unknownDevice,
      actualSettings: { deviceId: "unknown", width: 1920, height: 1080 },
      resolutionAttempt: "preferred",
      selectionReason: "unknown_compatibility",
      facingAssessment: "unknown",
    });
    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" }, deviceId: { exact: "unknown" } }) }));
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "device_selected",
        selectionReason: "unknown_compatibility",
        resolutionAttempt: "preferred",
        settings: { deviceId: "unknown", width: 1920, height: 1080 },
      }),
    );
  });

  it("최종 장치는 권한 스트림 deviceId가 아니라 camera N 후면 후보 우선순위로 선택한다", async () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "device-camera-2", label: "camera 2, facing back", facingMode: "environment" },
      { deviceId: "device-camera-0", label: "camera 0, facing back", facingMode: "environment" },
    ];
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(createStream({ deviceId: "device-camera-2", facingMode: "environment", width: 640, height: 480 }))),
      enumerateVideoInputs: createEnumerateVideoInputsMock(devices),
      openStream: createOpenStreamMock(createStream({ deviceId: "device-camera-0", facingMode: "environment", width: 1920, height: 1080 })),
    });
    const { diagnosticLogger, events } = createDiagnosticLogger();
    const usecase = createUsecase(gateway, undefined, diagnosticLogger);

    const result = await usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true });

    expect(result.selectedDevice).toEqual(devices[1]);
    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: "device-camera-0" } }) }));
    expect(gateway.enumerateVideoInputs).toHaveBeenCalledWith({ probeCapabilities: false });
    expect(events).toContainEqual({
      channel: "candidates",
      payload: expect.objectContaining({
        selectionSource: "policy_priority",
        selectedDevice: expect.objectContaining({ deviceId: maskCameraDeviceId("device-camera-0"), label: "camera 0, facing back" }),
      }),
    });
  });

  it("최종 스트림이 user로 확인되면 종료하고 전면 감지 오류로 실패한다", async () => {
    const finalStream = createStream({ deviceId: "unknown", facingMode: "user", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(createStream({ deviceId: "unknown", width: 640, height: 480 }))),
      enumerateVideoInputs: createEnumerateVideoInputsMock([{ deviceId: "unknown", label: "Camera" }]),
      openStream: createOpenStreamMock(finalStream),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_back", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_front_facing_detected" });

    expect(gateway.stopStream).toHaveBeenCalledWith(finalStream);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "front_facing_detected",
        stage: "final_stream",
        detectionSource: "track_settings",
        facingAssessment: "user",
        resolutionAttempt: "preferred",
        constraints: expect.objectContaining({
          video: expect.objectContaining({
            deviceId: { exact: "unknown" },
            facingMode: { ideal: "environment" },
            width: { ideal: 1920, min: 1920 },
            height: { ideal: 1080, min: 1080 },
          }),
        }),
        settings: { deviceId: "unknown", facingMode: "user", width: 1920, height: 1080 },
        target: "idcard_back",
        requireEnvironmentCamera: true,
      }),
    );
  });

  it("최종 settings의 deviceId가 전체 목록의 user 장치를 가리키면 종료한다", async () => {
    const finalStream = createStream({ deviceId: "front", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(createStream({ deviceId: "unknown", width: 640, height: 480 }))),
      enumerateVideoInputs: createEnumerateVideoInputsMock([
        { deviceId: "front", label: "Front Camera", facingMode: "user" },
        { deviceId: "unknown", label: "Camera" },
      ]),
      openStream: createOpenStreamMock(finalStream),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_front_facing_detected" });
    expect(gateway.stopStream).toHaveBeenCalledWith(finalStream);
    expect(events.at(-1)).toMatchObject({
      type: "front_facing_detected",
      stage: "final_stream",
      detectionSource: "enumerated_device",
      facingAssessment: "user",
      resolutionAttempt: "preferred",
    });
  });

  it("NotReadableError는 해상도 fallback 없이 기존 카메라 오류로 매핑한다", async () => {
    const notReadableError = new Error("Camera busy");
    notReadableError.name = "NotReadableError";
    const gateway = createGateway({ openStream: vi.fn().mockRejectedValueOnce(notReadableError) });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_not_readable" });
    expect(gateway.openStream).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["permission_checked", "permission_requested", "permission_granted"]);
  });

  it("권한 요청의 OverconstrainedError는 요청 constraints와 실패 지점을 observer에 알린다", async () => {
    const error = createConstraintError("OverconstrainedError", "facingMode");
    const gateway = createGateway({ requestPermission: vi.fn().mockRejectedValueOnce(error) });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_environment_not_available" });

    expect(events).toContainEqual({
      type: "constraint_failed",
      stage: "permission",
      errorName: "OverconstrainedError",
      constraint: "facingMode",
      constraints: { video: true, audio: false },
      target: "idcard_front",
      requireEnvironmentCamera: true,
    });
    expect(gateway.enumerateVideoInputs).not.toHaveBeenCalled();
  });

  it("1920x1080 width OverconstrainedError 후 같은 exact 장치로 1280x720을 요청한다", async () => {
    const fallbackStream = createStream({ deviceId: "main", facingMode: "environment", width: 1280, height: 720 });
    const gateway = createGateway({
      openStream: vi.fn().mockRejectedValueOnce(createConstraintError("OverconstrainedError", "width")).mockResolvedValueOnce(fallbackStream),
    });
    const { events, observer } = createObserver();
    const usecase = createUsecase(gateway, observer);

    const result = await usecase.execute({ target: "idcard_back", requireEnvironmentCamera: true });

    expect(result.resolutionAttempt).toBe("fallback");
    expect(gateway.openStream).toHaveBeenCalledTimes(2);
    expect(gateway.openStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 1280, min: 1280 },
          height: { ideal: 720, min: 720 },
          facingMode: { exact: "environment" },
          deviceId: { exact: "main" },
        }),
      }),
    );
    expect(events).toContainEqual({
      type: "constraint_failed",
      stage: "final_stream",
      resolutionAttempt: "preferred",
      errorName: "OverconstrainedError",
      constraint: "width",
      constraints: expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 1920, min: 1920 },
          height: { ideal: 1080, min: 1080 },
          facingMode: { exact: "environment" },
          deviceId: { exact: "main" },
        }),
      }),
      target: "idcard_back",
      requireEnvironmentCamera: true,
    });
  });

  it("legacy ConstraintNotSatisfiedError의 constraintName=height도 해상도 fallback한다", async () => {
    const gateway = createGateway({
      openStream: vi
        .fn()
        .mockRejectedValueOnce(createConstraintError("ConstraintNotSatisfiedError", "height", "constraintName"))
        .mockResolvedValueOnce(createStream({ deviceId: "main", facingMode: "environment", width: 1280, height: 720 })),
    });
    const usecase = createUsecase(gateway);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).resolves.toMatchObject({ resolutionAttempt: "fallback" });
    expect(gateway.openStream).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["OverconstrainedError", "facingMode", "constraint", "camera_environment_not_available"],
    ["OverconstrainedError", "deviceId", "constraint", "camera_not_found"],
    ["ConstraintNotSatisfiedError", "frameRate", "constraintName", "camera_constraint_not_supported"],
  ] as const)("%s의 %s 제약 실패는 해상도 fallback 없이 원인별 오류로 매핑한다", async (name, constraint, property, expectedCode) => {
    const gateway = createGateway({ openStream: vi.fn().mockRejectedValueOnce(createConstraintError(name, constraint, property)) });
    const usecase = createUsecase(gateway);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: expectedCode });
    expect(gateway.openStream).toHaveBeenCalledTimes(1);
  });

  it("제약 이름이 없는 OverconstrainedError는 일반 카메라 제약 오류로 매핑한다", async () => {
    const error = new Error("Overconstrained") as Error & { constraint?: string };
    error.name = "OverconstrainedError";
    const gateway = createGateway({ openStream: vi.fn().mockRejectedValueOnce(error) });
    const usecase = createUsecase(gateway);

    await expect(usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true })).rejects.toMatchObject({ code: "camera_constraint_not_supported" });
    expect(gateway.openStream).toHaveBeenCalledTimes(1);
  });

  it("데스크톱은 기존 permission/ideal 동작과 기본 selection reason을 유지한다", async () => {
    const stream = createStream({ deviceId: "main", width: 1920, height: 1080 });
    const gateway = createGateway({ openStream: createOpenStreamMock(stream) });
    const usecase = createUsecase(gateway);

    const result = await usecase.execute({ target: "idcard_front" });

    expect(gateway.requestPermission).toHaveBeenCalledWith({ video: true, audio: false });
    expect(gateway.enumerateVideoInputs).toHaveBeenCalledWith({ probeCapabilities: true });
    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" }, deviceId: { ideal: "main" } }) }));
    expect(result).toEqual({
      stream,
      selectedDevice: { deviceId: "main", label: "Back Camera", facingMode: "environment" },
      actualSettings: { deviceId: "main", width: 1920, height: 1080 },
      resolutionAttempt: "preferred",
      selectionReason: "default_compatibility",
      facingAssessment: "environment",
    });
  });

  it("데스크톱은 permission Stream 장치보다 기존 후면 후보 우선순위를 유지한다", async () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-a", label: "Back Camera A", facingMode: "environment" },
      { deviceId: "back-b", label: "Back Camera B", facingMode: "environment" },
    ];
    const finalStream = createStream({ deviceId: "back-b", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(createStream({ deviceId: "back-a", width: 640, height: 480 }))),
      enumerateVideoInputs: createEnumerateVideoInputsMock(devices),
      openStream: createOpenStreamMock(finalStream),
    });
    const usecase = createUsecase(gateway);

    const result = await usecase.execute({ target: "idcard_front" });

    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ deviceId: { ideal: "back-b" } }) }));
    expect(result.selectedDevice).toEqual(devices[1]);
  });

  it("열거 장치와 장치별 선별 사유 및 최종 후보를 구조화해 기록한다", async () => {
    const devices: CameraDeviceInfo[] = [
      {
        deviceId: "ultra-camera-id",
        label: "Back Ultra Wide Camera",
        facingMode: "environment",
        capabilities: {
          width: { min: 640, max: 3840 },
          height: { min: 480, max: 2160 },
          zoom: { min: 0.5, max: 10 },
        } as MediaTrackCapabilities,
      },
      {
        deviceId: "main-camera-id",
        label: "Back Camera",
        facingMode: "environment",
        capabilities: {
          width: { min: 640, max: 1920 },
          height: { min: 480, max: 1080 },
          zoom: { min: 1, max: 10 },
        } as MediaTrackCapabilities,
      },
      { deviceId: "front-camera-id", label: "Front Camera", facingMode: "user" },
    ];
    const finalStream = createStream({ deviceId: "main-camera-id", facingMode: "environment", width: 1920, height: 1080 });
    const gateway = createGateway({
      enumerateVideoInputs: createEnumerateVideoInputsMock(devices),
      openStream: createOpenStreamMock(finalStream),
    });
    const { diagnosticLogger, events } = createDiagnosticLogger();
    const usecase = createUsecase(gateway, undefined, diagnosticLogger);

    await usecase.execute({ target: "idcard_front" });

    expect(events).toContainEqual({
      channel: "devices",
      payload: expect.objectContaining({
        phase: "enumerated",
        probeCapabilities: true,
        devices: [
          expect.objectContaining({ label: "Back Ultra Wide Camera", facingMode: "environment", environment: true, width: { min: 640, max: 3840 }, height: { min: 480, max: 2160 } }),
          expect.objectContaining({ label: "Back Camera", facingMode: "environment", environment: true, width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 } }),
          expect.objectContaining({ label: "Front Camera", facingMode: "user", environment: false, width: null, height: null }),
        ],
      }),
    });
    expect(events.filter(({ channel }) => channel === "selection")).toEqual(
      expect.arrayContaining([
        {
          channel: "selection",
          payload: expect.objectContaining({
            device: expect.objectContaining({ deviceId: maskCameraDeviceId("ultra-camera-id"), label: "Back Ultra Wide Camera" }),
            passed: false,
            reasons: ["excluded_by_label", "excluded_by_zoom_min"],
          }),
        },
        {
          channel: "selection",
          payload: expect.objectContaining({
            device: expect.objectContaining({ deviceId: maskCameraDeviceId("main-camera-id"), label: "Back Camera" }),
            passed: true,
            reasons: ["verified_environment"],
          }),
        },
        {
          channel: "selection",
          payload: expect.objectContaining({
            device: expect.objectContaining({ deviceId: maskCameraDeviceId("front-camera-id"), label: "Front Camera" }),
            passed: false,
            reasons: ["environment_candidate_preferred"],
          }),
        },
      ]),
    );
    expect(events).toContainEqual({
      channel: "candidates",
      payload: expect.objectContaining({
        selectionSource: "policy_priority",
        devices: [expect.objectContaining({ deviceId: maskCameraDeviceId("main-camera-id"), label: "Back Camera" })],
        selectedDevice: expect.objectContaining({ deviceId: maskCameraDeviceId("main-camera-id"), label: "Back Camera" }),
      }),
    });
  });

  it("권한과 최종 getUserMedia 요청의 constraints 및 실제 settings를 기록한다", async () => {
    const permissionStream = createStream({ deviceId: "main-camera-id", facingMode: "environment", width: 640, height: 480 });
    const finalStream = createStream({ deviceId: "main-camera-id", facingMode: "environment", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(permissionStream)),
      enumerateVideoInputs: createEnumerateVideoInputsMock([{ deviceId: "main-camera-id", label: "Back Camera", facingMode: "environment" }]),
      openStream: createOpenStreamMock(finalStream),
    });
    const { diagnosticLogger, events } = createDiagnosticLogger();
    const usecase = createUsecase(gateway, undefined, diagnosticLogger);

    await usecase.execute({ target: "idcard_front", requireEnvironmentCamera: true });

    expect(events.filter(({ channel }) => channel === "getUserMedia")).toEqual([
      {
        channel: "getUserMedia",
        payload: expect.objectContaining({
          stage: "permission",
          status: "requested",
          constraints: { video: true, audio: false },
        }),
      },
      {
        channel: "getUserMedia",
        payload: expect.objectContaining({
          stage: "permission",
          status: "succeeded",
          settings: {
            deviceId: maskCameraDeviceId("main-camera-id"),
            facingMode: "environment",
            environment: true,
            width: 640,
            height: 480,
          },
        }),
      },
      {
        channel: "getUserMedia",
        payload: expect.objectContaining({
          stage: "final_stream",
          status: "requested",
          resolutionAttempt: "preferred",
          constraints: expect.objectContaining({
            video: expect.objectContaining({ deviceId: { exact: maskCameraDeviceId("main-camera-id") }, facingMode: { exact: "environment" } }),
          }),
        }),
      },
      {
        channel: "getUserMedia",
        payload: expect.objectContaining({
          stage: "final_stream",
          status: "succeeded",
          resolutionAttempt: "preferred",
          settings: {
            deviceId: maskCameraDeviceId("main-camera-id"),
            facingMode: "environment",
            environment: true,
            width: 1920,
            height: 1080,
          },
        }),
      },
    ]);
  });

  it("브라우저가 후보 밖 장치를 열면 요청 장치와 실제 장치의 불일치를 기록한다", async () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "main-camera-id", label: "Back Camera", facingMode: "environment" },
      { deviceId: "ultra-camera-id", label: "Back Ultra Wide Camera", facingMode: "environment" },
    ];
    const gateway = createGateway({
      enumerateVideoInputs: createEnumerateVideoInputsMock(devices),
      openStream: createOpenStreamMock(createStream({ deviceId: "ultra-camera-id", facingMode: "environment", width: 1920, height: 1080 })),
    });
    const { diagnosticLogger, events } = createDiagnosticLogger();
    const usecase = createUsecase(gateway, undefined, diagnosticLogger);

    await usecase.execute({ target: "idcard_front" });

    expect(events).toContainEqual({
      channel: "selection",
      payload: expect.objectContaining({
        phase: "final_stream_validation",
        requestedDevice: expect.objectContaining({ deviceId: maskCameraDeviceId("main-camera-id"), label: "Back Camera" }),
        actualDevice: expect.objectContaining({ deviceId: maskCameraDeviceId("ultra-camera-id"), label: "Back Ultra Wide Camera" }),
        actualDeviceIsCandidate: false,
        deviceIdMatched: false,
        passed: true,
      }),
    });
  });

  it("getUserMedia 실패 시 오류 원문 없이 name과 constraint를 기록한다", async () => {
    const error = createConstraintError("OverconstrainedError", "width");
    const gateway = createGateway({ openStream: vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error) });
    const { diagnosticLogger, events } = createDiagnosticLogger();
    const usecase = createUsecase(gateway, undefined, diagnosticLogger);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({ code: "camera_resolution_not_supported" });

    expect(events).toContainEqual({
      channel: "getUserMedia",
      payload: expect.objectContaining({
        stage: "final_stream",
        status: "failed",
        resolutionAttempt: "preferred",
        error: { name: "OverconstrainedError", constraint: "width" },
      }),
    });
    expect(JSON.stringify(events)).not.toContain(error.message);
  });

  it("데스크톱은 후면 후보가 없으면 단일 전면 웹캠으로 최종 스트림을 준비한다", async () => {
    const frontDevice: CameraDeviceInfo = { deviceId: "integrated-camera", label: "Front Camera", facingMode: "user" };
    const finalStream = createStream({ deviceId: frontDevice.deviceId, facingMode: "user", width: 1920, height: 1080 });
    const gateway = createGateway({
      requestPermission: vi.fn(() => Promise.resolve(createStream({ deviceId: frontDevice.deviceId, facingMode: "user", width: 640, height: 480 }))),
      enumerateVideoInputs: createEnumerateVideoInputsMock([frontDevice]),
      openStream: createOpenStreamMock(finalStream),
    });
    const usecase = createUsecase(gateway);

    const result = await usecase.execute({ target: "idcard_front" });

    expect(gateway.openStream).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" }, deviceId: { exact: frontDevice.deviceId } }) }));
    expect(result).toEqual({
      stream: finalStream,
      selectedDevice: frontDevice,
      actualSettings: { deviceId: frontDevice.deviceId, facingMode: "user", width: 1920, height: 1080 },
      resolutionAttempt: "preferred",
      selectionReason: "default_compatibility",
      facingAssessment: "user",
    });
  });

  it("실행된 스트림이 촬영 조건을 만족하지 못하면 종료하고 실패한다", async () => {
    const invalidStream = createStream({ deviceId: "main", width: 1024, height: 576 });
    const gateway = createGateway({ openStream: vi.fn().mockResolvedValueOnce(invalidStream) });
    const usecase = createUsecase(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({ code: "camera_stream_invalid" });
    expect(gateway.stopStream).toHaveBeenCalledWith(invalidStream);
  });

  it("observer 실패는 카메라 준비를 중단하지 않는다", async () => {
    const gateway = createGateway();
    const observer = vi.fn(() => {
      throw new IdcardCameraError("camera_unknown");
    });
    const usecase = createUsecase(gateway, observer);

    await expect(usecase.execute({ target: "idcard_front" })).resolves.toMatchObject({ resolutionAttempt: "preferred" });
  });
});
