import { CameraDeviceInfo } from "@lib/auth/types/camera";
import { IdcardCameraPolicy } from "../idcard_camera_policy";

const createStream = (settings: MediaTrackSettings, readyState: MediaStreamTrackState = "live") => {
  const track = {
    readyState,
    getSettings: jest.fn(() => settings),
  } as unknown as MediaStreamTrack;

  return {
    getVideoTracks: jest.fn(() => [track]),
  } as unknown as MediaStream;
};

describe("IdcardCameraPolicy", () => {
  const policy = new IdcardCameraPolicy();

  it("후면 카메라 후보만 선별한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "back", label: "Back Camera", facingMode: "environment" },
      { deviceId: "unknown", label: "Unknown Camera" },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([{ deviceId: "back", label: "Back Camera", facingMode: "environment" }]);
  });

  it("ultra/tele/triple 후면 카메라는 제외한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "ultra", label: "Back Ultra Wide Camera", facingMode: "environment" },
      { deviceId: "tele", label: "Back Tele Camera", facingMode: "environment" },
      { deviceId: "triple", label: "Back Triple Camera", facingMode: "environment" },
      { deviceId: "main", label: "Back Camera", facingMode: "environment" },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([{ deviceId: "main", label: "Back Camera", facingMode: "environment" }]);
  });

  it("wide/광각 후면 카메라도 제외한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "wide", label: "Back Wide Camera", facingMode: "environment" },
      { deviceId: "korean-wide-text", label: "후면 듀얼 와이드 카메라", facingMode: "environment" },
      { deviceId: "korean-wide", label: "후면 광각 카메라", facingMode: "environment" },
      { deviceId: "main", label: "Facing back:0", facingMode: "environment" },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([{ deviceId: "main", label: "Facing back:0", facingMode: "environment" }]);
  });

  it("zoom.min이 1보다 작은 후면 카메라는 wide 계열 후보로 보고 제외한다", () => {
    const devices: CameraDeviceInfo[] = [
      {
        deviceId: "wide-by-zoom",
        label: "후면 듀얼 카메라",
        facingMode: "environment",
        capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
      },
      {
        deviceId: "main",
        label: "후면 카메라",
        facingMode: "environment",
        capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities,
      },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([
      {
        deviceId: "main",
        label: "후면 카메라",
        facingMode: "environment",
        capabilities: { zoom: { min: 1, max: 10 } },
      },
    ]);
  });

  it("Facing back:N 후보 중 숫자가 낮은 후면 카메라를 우선 선택한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-2", label: "Facing back:2", facingMode: "environment" },
      { deviceId: "back-0", label: "Facing back:0", facingMode: "environment" },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-0", label: "Facing back:0", facingMode: "environment" });
  });

  it("Facing back:N label의 공백 변형도 인식한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-2", label: "Facing back : 2", facingMode: "environment" },
      { deviceId: "back-0", label: "Facing back : 0", facingMode: "environment" },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-0", label: "Facing back : 0", facingMode: "environment" });
  });

  it("Facing back:N 후보가 하나라도 있으면 일반 label보다 우선 선택한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "plain", label: "Back Camera", facingMode: "environment" },
      { deviceId: "back-2", label: "Facing back:2", facingMode: "environment" },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-2", label: "Facing back:2", facingMode: "environment" });
  });

  it("Facing back:N 후보가 없으면 기존처럼 마지막 후면 후보를 선택한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-a", label: "Back Camera A", facingMode: "environment" },
      { deviceId: "back-b", label: "Back Camera B", facingMode: "environment" },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-b", label: "Back Camera B", facingMode: "environment" });
  });

  it("preferred/fallback 해상도 제약을 생성한다", () => {
    const device: CameraDeviceInfo = { deviceId: "main", label: "Back Camera", facingMode: "environment" };
    const [preferred, fallback] = policy.getResolutionCandidates();

    expect(policy.createMediaStreamConstraints(device, preferred)).toEqual(
      expect.objectContaining({
        video: expect.objectContaining({
          deviceId: { ideal: "main" },
          width: { ideal: 1920, min: 1920 },
          height: { ideal: 1080, min: 1080 },
          facingMode: { ideal: "environment" },
        }),
        audio: false,
      }),
    );
    expect(policy.createMediaStreamConstraints(device, fallback)).toEqual(
      expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 1280, min: 1280 },
          height: { ideal: 720, min: 720 },
        }),
      }),
    );
  });

  it("실제 설정값이 fallback 기준 이상이고 live track이면 유효하다", () => {
    const stream = createStream({ deviceId: "main", width: 1280, height: 720 });

    expect(policy.validateStream(stream)).toEqual({
      valid: true,
      settings: { deviceId: "main", width: 1280, height: 720 },
    });
  });

  it("실제 설정값이 preferred 기준 portrait 방향이면 유효하다", () => {
    const stream = createStream({ deviceId: "main", width: 1080, height: 1920 });

    expect(policy.validateStream(stream)).toEqual({
      valid: true,
      settings: { deviceId: "main", width: 1080, height: 1920 },
    });
  });

  it("실제 설정값이 fallback 기준 portrait 방향이면 유효하다", () => {
    const stream = createStream({ deviceId: "main", width: 720, height: 1280 });

    expect(policy.validateStream(stream)).toEqual({
      valid: true,
      settings: { deviceId: "main", width: 720, height: 1280 },
    });
  });

  it("긴 변만 충분하고 짧은 변이 fallback 기준 미만이면 실패한다", () => {
    const stream = createStream({ deviceId: "main", width: 1920, height: 700 });

    expect(policy.validateStream(stream)).toEqual({
      valid: false,
      settings: { deviceId: "main", width: 1920, height: 700 },
    });
  });

  it("실제 설정값이 fallback 기준 미만이면 실패한다", () => {
    const stream = createStream({ deviceId: "main", width: 1024, height: 576 });

    expect(policy.validateStream(stream)).toEqual({
      valid: false,
      settings: { deviceId: "main", width: 1024, height: 576 },
    });
  });
});
