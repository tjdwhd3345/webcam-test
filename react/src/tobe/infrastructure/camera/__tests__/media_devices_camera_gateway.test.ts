import { describe, expect, it, vi } from "vitest";
import { PrepareIdcardCameraStream } from "@tobe/domain/camera/prepare_idcard_camera_stream";
import type { IdcardCameraDiagnosticEvent, IdcardCameraDiagnosticLogger } from "@tobe/domain/camera/idcard_camera_diagnostics";
import { maskCameraDeviceId } from "@tobe/domain/camera/idcard_camera_diagnostics";
import { MediaDevicesCameraGateway } from "@tobe/infrastructure/camera/media_devices_camera_gateway";

const createMediaDeviceInfo = ({ deviceId, label, capabilities }: { deviceId: string; label: string; capabilities?: MediaTrackCapabilities }): MediaDeviceInfo => {
  const device: MediaDeviceInfo = {
    deviceId,
    groupId: `group-${deviceId}`,
    kind: "videoinput",
    label,
    toJSON: () => ({
      deviceId,
      groupId: `group-${deviceId}`,
      kind: "videoinput",
      label,
    }),
  };

  if (!capabilities) return device;

  return {
    ...device,
    getCapabilities: () => capabilities,
  } as InputDeviceInfo;
};

const createProbeStream = (settings: MediaTrackSettings = {}): MediaStream => {
  const track = {
    readyState: "live",
    getCapabilities: () => ({}),
    getSettings: () => settings,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;

  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
};

const createGateway = (devices: MediaDeviceInfo[], probeStream = createProbeStream(), diagnosticLogger?: IdcardCameraDiagnosticLogger) => {
  const getUserMedia = vi.fn().mockResolvedValue(probeStream);
  const mediaDevices = {
    enumerateDevices: vi.fn().mockResolvedValue(devices),
    getUserMedia,
  } as unknown as MediaDevices;
  const gateway = new MediaDevicesCameraGateway(() => ({ mediaDevices }) as Navigator, diagnosticLogger);

  return { gateway, getUserMedia };
};

describe("MediaDevicesCameraGateway", () => {
  it("capabilities와 label에 방향 정보가 없으면 facingMode를 undefined로 보존한다", async () => {
    const { gateway } = createGateway([createMediaDeviceInfo({ deviceId: "unknown-camera", label: "" })]);

    const cameras = await gateway.enumerateVideoInputs({ probeCapabilities: false });

    expect(cameras[0]?.facingMode).toBeUndefined();
  });

  it("capabilities의 facingMode로 전면과 후면 카메라를 분류한다", async () => {
    const { gateway } = createGateway([
      createMediaDeviceInfo({
        deviceId: "capability-rear",
        label: "Camera 1",
        capabilities: { facingMode: ["environment"] },
      }),
      createMediaDeviceInfo({
        deviceId: "capability-front",
        label: "Camera 2",
        capabilities: { facingMode: ["user"] },
      }),
    ]);

    const cameras = await gateway.enumerateVideoInputs({ probeCapabilities: false });

    expect(cameras.map(({ deviceId, facingMode }) => ({ deviceId, facingMode }))).toEqual([
      { deviceId: "capability-rear", facingMode: "environment" },
      { deviceId: "capability-front", facingMode: "user" },
    ]);
  });

  it("label의 방향 정보로 전면과 후면 카메라를 분류한다", async () => {
    const { gateway } = createGateway([createMediaDeviceInfo({ deviceId: "label-rear", label: "Rear Camera" }), createMediaDeviceInfo({ deviceId: "label-front", label: "Front Camera" })]);

    const cameras = await gateway.enumerateVideoInputs({ probeCapabilities: false });

    expect(cameras.map(({ deviceId, facingMode }) => ({ deviceId, facingMode }))).toEqual([
      { deviceId: "label-rear", facingMode: "environment" },
      { deviceId: "label-front", facingMode: "user" },
    ]);
  });

  it("장치 열거 중 getCapabilities가 없는 장치를 getUserMedia로 열지 않는다", async () => {
    const { gateway, getUserMedia } = createGateway([createMediaDeviceInfo({ deviceId: "camera-without-capabilities", label: "Camera" })]);

    await gateway.enumerateVideoInputs({ probeCapabilities: false });

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("capability probe 전에 전체 video input 목록을 기록한다", async () => {
    const events: IdcardCameraDiagnosticEvent[] = [];
    const diagnosticLogger: IdcardCameraDiagnosticLogger = (channel, payload) => events.push({ channel, payload });
    const devices = [createMediaDeviceInfo({ deviceId: "front-camera-id", label: "Front Camera" }), createMediaDeviceInfo({ deviceId: "back-camera-id", label: "Back Camera" })];
    const { gateway } = createGateway(devices, createProbeStream(), diagnosticLogger);

    await gateway.enumerateVideoInputs({ probeCapabilities: false });

    expect(events[0]).toEqual({
      channel: "devices",
      payload: {
        phase: "enumerated_raw",
        probeCapabilities: false,
        count: 2,
        devices: [
          {
            index: 0,
            deviceId: maskCameraDeviceId("front-camera-id"),
            label: "Front Camera",
            facingMode: "user",
            environment: false,
            width: null,
            height: null,
            zoom: null,
          },
          {
            index: 1,
            deviceId: maskCameraDeviceId("back-camera-id"),
            label: "Back Camera",
            facingMode: "environment",
            environment: true,
            width: null,
            height: null,
            zoom: null,
          },
        ],
      },
    });
  });

  it("desktop legacy 열거는 probe 후에도 방향 정보가 없으면 facingMode를 undefined로 보존한다", async () => {
    const probeStream = createProbeStream({ deviceId: "unknown-camera" });
    const { gateway, getUserMedia } = createGateway([createMediaDeviceInfo({ deviceId: "unknown-camera", label: "Camera" })], probeStream);

    const cameras = await gateway.enumerateVideoInputs({ probeCapabilities: true });

    expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: "unknown-camera" } }, audio: false });
    expect(cameras).toEqual([
      expect.objectContaining({
        deviceId: "unknown-camera",
        facingMode: undefined,
      }),
    ]);
  });

  it("desktop legacy probe의 constraints와 실제 settings 및 capabilities를 기록한다", async () => {
    const events: IdcardCameraDiagnosticEvent[] = [];
    const diagnosticLogger: IdcardCameraDiagnosticLogger = (channel, payload) => events.push({ channel, payload });
    const probeTrack = {
      readyState: "live",
      getCapabilities: () => ({
        width: { min: 640, max: 1920 },
        height: { min: 480, max: 1080 },
        zoom: { min: 1, max: 8 },
      }),
      getSettings: () => ({ deviceId: "legacy-camera-id", facingMode: "user", width: 1280, height: 720 }),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const probeStream = {
      getTracks: () => [probeTrack],
      getVideoTracks: () => [probeTrack],
    } as unknown as MediaStream;
    const { gateway } = createGateway([createMediaDeviceInfo({ deviceId: "legacy-camera-id", label: "Camera" })], probeStream, diagnosticLogger);

    await gateway.enumerateVideoInputs({ probeCapabilities: true });

    expect(events.filter(({ channel }) => channel === "getUserMedia")).toEqual([
      {
        channel: "getUserMedia",
        payload: {
          stage: "device_probe",
          status: "requested",
          deviceId: maskCameraDeviceId("legacy-camera-id"),
          constraints: { video: { deviceId: { exact: maskCameraDeviceId("legacy-camera-id") } }, audio: false },
        },
      },
      {
        channel: "getUserMedia",
        payload: {
          stage: "device_probe",
          status: "succeeded",
          deviceId: maskCameraDeviceId("legacy-camera-id"),
          settings: {
            deviceId: maskCameraDeviceId("legacy-camera-id"),
            facingMode: "user",
            environment: false,
            width: 1280,
            height: 720,
          },
          capabilities: {
            width: { min: 640, max: 1920 },
            height: { min: 480, max: 1080 },
            zoom: { min: 1, max: 8 },
          },
        },
      },
    ]);
  });

  it("desktop legacy 단일 카메라는 unknown fallback으로 exact 선택한다", async () => {
    const device = createMediaDeviceInfo({ deviceId: "integrated-camera", label: "Camera" });
    const permissionStream = createProbeStream({ deviceId: device.deviceId, width: 640, height: 480 });
    const probeStream = createProbeStream({ deviceId: device.deviceId });
    const finalStream = createProbeStream({ deviceId: device.deviceId, width: 1920, height: 1080 });
    const getUserMedia = vi.fn().mockResolvedValueOnce(permissionStream).mockResolvedValueOnce(probeStream).mockResolvedValueOnce(finalStream);
    const mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([device]),
      getUserMedia,
    } as unknown as MediaDevices;
    const gateway = new MediaDevicesCameraGateway(() => ({ mediaDevices }) as Navigator);
    const usecase = new PrepareIdcardCameraStream(gateway);

    const result = await usecase.execute({ target: "idcard_front" });

    expect(getUserMedia).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        video: expect.objectContaining({
          deviceId: { exact: device.deviceId },
          facingMode: { ideal: "environment" },
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        stream: finalStream,
        selectedDevice: expect.objectContaining({ deviceId: device.deviceId, facingMode: undefined }),
        facingAssessment: "unknown",
      }),
    );
  });
});
