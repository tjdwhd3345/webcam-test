import { describe, expect, it, vi } from "vitest";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { IDCARD_CAMERA_PREFERRED_RESOLUTION, IdcardCameraPolicy } from "../idcard_camera_policy";

const createStream = (settings: MediaTrackSettings, readyState: MediaStreamTrackState = "live") => {
  const track = {
    readyState,
    getSettings: vi.fn(() => settings),
  } as unknown as MediaStreamTrack;

  return {
    getVideoTracks: vi.fn(() => [track]),
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

  it("ultra/tele 및 zoom 근거가 없는 triple 후면 카메라는 제외한다", () => {
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

  it("zoom 1을 포함하는 Triple 가상 후면 카메라는 근접 초점 후보로 허용한다", () => {
    const devices: CameraDeviceInfo[] = [
      {
        deviceId: "triple-en",
        label: "Back Triple Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
      },
      {
        deviceId: "triple-ko",
        label: "후면 트리플 카메라",
        facingMode: "environment",
        capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities,
      },
      {
        deviceId: "triple-max-one",
        label: "Back Triple Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 0.5, max: 1 } } as MediaTrackCapabilities,
      },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual(devices);
  });

  it.each([
    {
      caseName: "전면 장치",
      device: { deviceId: "triple-user", label: "Triple Camera", facingMode: "user", capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities },
    },
    {
      caseName: "방향을 확인할 수 없는 장치",
      device: { deviceId: "triple-unknown", label: "Triple Camera", capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities },
    },
    {
      caseName: "zoom.min이 없는 장치",
      device: { deviceId: "triple-without-min", label: "Back Triple Camera", facingMode: "environment", capabilities: { zoom: { max: 10 } } as MediaTrackCapabilities },
    },
    {
      caseName: "zoom.max가 없는 장치",
      device: { deviceId: "triple-without-max", label: "Back Triple Camera", facingMode: "environment", capabilities: { zoom: { min: 0.5 } } as MediaTrackCapabilities },
    },
    {
      caseName: "zoom.max가 1보다 작은 장치",
      device: { deviceId: "triple-below-one", label: "Back Triple Camera", facingMode: "environment", capabilities: { zoom: { min: 0.5, max: 0.9 } } as MediaTrackCapabilities },
    },
    {
      caseName: "zoom.min이 1보다 큰 장치",
      device: { deviceId: "triple-above-one", label: "Back Triple Camera", facingMode: "environment", capabilities: { zoom: { min: 1.1, max: 10 } } as MediaTrackCapabilities },
    },
  ])("$caseName Triple은 adaptive 후보로 허용하지 않는다", ({ device }) => {
    expect(policy.selectVideoInputDevices([device as CameraDeviceInfo])).toEqual([]);
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

  it("camera N, facing back 후보는 열거 순서와 관계없이 숫자가 낮은 카메라를 우선 선택한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-0", label: "camera 0, facing back", facingMode: "environment" },
      { deviceId: "back-2", label: "camera 2, facing back", facingMode: "environment" },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-0", label: "camera 0, facing back", facingMode: "environment" });
  });

  it("Facing back:N 후보가 하나라도 있으면 일반 label보다 우선 선택한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "back-2", label: "Facing back:2", facingMode: "environment" },
      {
        deviceId: "triple",
        label: "Back Triple Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
      },
    ];

    expect(policy.selectPreferredDevice(devices)).toEqual({ deviceId: "back-2", label: "Facing back:2", facingMode: "environment" });
  });

  it("adaptive Triple 후보를 열거 순서와 관계없이 일반 Dual/Back보다 우선 선택한다", () => {
    const triple: CameraDeviceInfo = {
      deviceId: "triple",
      label: "Back Triple Camera",
      facingMode: "environment",
      capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
    };
    const devices: CameraDeviceInfo[] = [
      triple,
      {
        deviceId: "dual",
        label: "Back Dual Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities,
      },
      {
        deviceId: "main",
        label: "Back Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities,
      },
    ];

    expect(policy.selectPreferredDevice(policy.selectVideoInputDevices(devices))).toBe(triple);
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

  it("모바일 권한 요청은 장치를 제한하지 않고 최종 선별과 분리한다", () => {
    expect(policy.createPermissionConstraints()).toEqual({
      video: true,
      audio: false,
    });
  });

  it("모바일에서 확인된 후면 후보는 선택 장치를 exact로 고정하고 후면을 ideal로 요청한다", () => {
    const device: CameraDeviceInfo = { deviceId: "main", label: "Back Camera", facingMode: "environment" };

    expect(policy.createMediaStreamConstraints(device, IDCARD_CAMERA_PREFERRED_RESOLUTION, true)).toEqual(
      expect.objectContaining({
        video: expect.objectContaining({
          facingMode: { ideal: "environment" },
          deviceId: { exact: "main" },
        }),
        audio: false,
      }),
    );
  });

  it("모바일 unknown 호환 후보는 선택 장치를 exact로 고정하고 후면을 ideal로 요청한다", () => {
    const device: CameraDeviceInfo = { deviceId: "unknown", label: "FaceTime HD 카메라" };

    expect(policy.createMediaStreamConstraints(device, IDCARD_CAMERA_PREFERRED_RESOLUTION, true)).toEqual(
      expect.objectContaining({
        video: expect.objectContaining({
          facingMode: { ideal: "environment" },
          deviceId: { exact: "unknown" },
        }),
        audio: false,
      }),
    );
  });

  it("모바일은 확인된 후면 후보를 unknown보다 우선하고 후면이 없을 때만 unknown을 허용한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
      { deviceId: "back", label: "Back Camera", facingMode: "environment" },
    ];

    expect(policy.selectVideoInputDevices(devices, true)).toEqual([{ deviceId: "back", label: "Back Camera", facingMode: "environment" }]);
    expect(policy.getSelectionReason({ deviceId: "back", label: "Back Camera", facingMode: "environment" }, true)).toBe("verified_environment");
    expect(policy.selectVideoInputDevices(devices.slice(0, 2), true)).toEqual([{ deviceId: "unknown", label: "Unknown Camera" }]);
    expect(policy.getSelectionReason({ deviceId: "unknown", label: "Unknown Camera" }, true)).toBe("unknown_compatibility");
  });

  it("모바일에서 실제 settings가 user면 충분한 해상도라도 invalid다", () => {
    const stream = createStream({ deviceId: "front", facingMode: "user", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        requireEnvironmentCamera: true,
      }),
    ).toEqual({
      valid: false,
      settings: { deviceId: "front", facingMode: "user", width: 1920, height: 1080 },
    });
  });

  it("모바일에서 실제 deviceId가 user 장치를 가리키면 충분한 해상도라도 invalid다", () => {
    const stream = createStream({ deviceId: "front", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        devices: [{ deviceId: "front", label: "Front Camera", facingMode: "user" }],
        requireEnvironmentCamera: true,
      }),
    ).toEqual({
      valid: false,
      settings: { deviceId: "front", width: 1920, height: 1080 },
    });
  });

  it("모바일에서 실제 deviceId가 요청한 장치와 다르면 충분한 해상도라도 invalid다", () => {
    const stream = createStream({ deviceId: "other", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        devices: [{ deviceId: "other", label: "Unknown Camera" }],
        requestedDevice: { deviceId: "back", label: "Back Camera", facingMode: "environment" },
        requireEnvironmentCamera: true,
      }),
    ).toEqual({
      valid: false,
      settings: { deviceId: "other", width: 1920, height: 1080 },
    });
  });

  it("모바일에서 facingMode 정보가 전혀 없고 최소 해상도를 만족하면 valid다", () => {
    const stream = createStream({ deviceId: "unknown", width: 1280, height: 720 });

    expect(
      policy.validateStream(stream, {
        devices: [{ deviceId: "unknown", label: "Unknown Camera" }],
        requestedDevice: { deviceId: "unknown", label: "Unknown Camera" },
        requireEnvironmentCamera: true,
      }),
    ).toEqual({
      valid: true,
      settings: { deviceId: "unknown", width: 1280, height: 720 },
    });
  });

  it("데스크톱 권한과 최종 스트림 요청은 기존 ideal 제약을 유지한다", () => {
    const device: CameraDeviceInfo = { deviceId: "main", label: "Back Camera", facingMode: "environment" };

    expect(policy.createPermissionConstraints()).toEqual({ video: true, audio: false });
    expect(policy.getSelectionReason(device, false)).toBe("default_compatibility");
    expect(policy.createMediaStreamConstraints(device, IDCARD_CAMERA_PREFERRED_RESOLUTION, false)).toEqual(
      expect.objectContaining({
        video: expect.objectContaining({
          facingMode: { ideal: "environment" },
          deviceId: { ideal: "main" },
        }),
        audio: false,
      }),
    );
  });

  it("모바일 strict는 일반 후면이 없을 때 unknown만 호환 후보로 사용한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
    ];

    expect(policy.selectVideoInputDevices(devices, true)).toEqual([{ deviceId: "unknown", label: "Unknown Camera" }]);
  });

  it("데스크톱은 일반 후면이 없을 때 전면과 unknown만 호환 후보로 사용한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "wide", label: "Back Ultra Wide Camera", facingMode: "environment" },
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
    ]);
  });

  it("데스크톱 호환 fallback에서도 광각으로 확인된 unknown 장치는 제외한다", () => {
    const devices: CameraDeviceInfo[] = [
      {
        deviceId: "wide-by-zoom",
        label: "Camera",
        capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
      },
      { deviceId: "unknown", label: "Unknown Camera" },
    ];

    expect(policy.selectVideoInputDevices(devices)).toEqual([{ deviceId: "unknown", label: "Unknown Camera" }]);
  });

  it("데스크톱 호환 fallback은 exact로 고정할 deviceId가 없는 장치를 제외한다", () => {
    expect(policy.selectVideoInputDevices([{ deviceId: "", label: "Unknown Camera" }])).toEqual([]);
  });

  it("일반 후면 후보가 있으면 장치별 통과와 탈락 사유를 동일한 선별 결과로 제공한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "main", label: "Back Camera", facingMode: "environment" },
      { deviceId: "ultra", label: "Back Ultra Wide Camera", facingMode: "environment" },
      {
        deviceId: "zoom-wide",
        label: "Camera",
        facingMode: "environment",
        capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
      },
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
    ];

    const decisions = policy.evaluateVideoInputDevices(devices);

    expect(decisions.map(({ device, passed, reasons }) => ({ deviceId: device.deviceId, passed, reasons }))).toEqual([
      { deviceId: "main", passed: true, reasons: ["verified_environment"] },
      { deviceId: "ultra", passed: false, reasons: ["excluded_by_label"] },
      { deviceId: "zoom-wide", passed: false, reasons: ["excluded_by_zoom_min"] },
      { deviceId: "front", passed: false, reasons: ["environment_candidate_preferred"] },
      { deviceId: "unknown", passed: false, reasons: ["environment_candidate_preferred"] },
    ]);
    expect(policy.selectVideoInputDevices(devices)).toEqual(decisions.filter(({ passed }) => passed).map(({ device }) => device));
  });

  it("일반 후면 후보가 없으면 모바일과 데스크톱 호환 후보의 판단 사유를 구분한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "front", label: "Front Camera", facingMode: "user" },
      { deviceId: "unknown", label: "Unknown Camera" },
      { deviceId: "", label: "Camera without id" },
    ];

    expect(policy.evaluateVideoInputDevices(devices, true).map(({ device, passed, reasons }) => ({ deviceId: device.deviceId, passed, reasons }))).toEqual([
      { deviceId: "front", passed: false, reasons: ["front_camera_not_allowed"] },
      { deviceId: "unknown", passed: true, reasons: ["mobile_unknown_compatibility"] },
      { deviceId: "", passed: false, reasons: ["missing_device_id"] },
    ]);
    expect(policy.evaluateVideoInputDevices(devices).map(({ device, passed, reasons }) => ({ deviceId: device.deviceId, passed, reasons }))).toEqual([
      { deviceId: "front", passed: true, reasons: ["desktop_user_compatibility"] },
      { deviceId: "unknown", passed: true, reasons: ["desktop_unknown_compatibility"] },
      { deviceId: "", passed: false, reasons: ["missing_device_id"] },
    ]);
  });

  it("모바일은 deviceId가 없는 후면 후보를 제외하고 exact로 고정 가능한 unknown 후보를 사용한다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "", label: "Back Camera", facingMode: "environment" },
      { deviceId: "unknown", label: "Camera" },
    ];

    expect(policy.selectVideoInputDevices(devices, true)).toEqual([{ deviceId: "unknown", label: "Camera" }]);
  });

  it("데스크톱은 deviceId가 없는 확인된 후면 장치의 기존 ideal 호환 경로를 유지한다", () => {
    const device: CameraDeviceInfo = { deviceId: "", label: "Back Camera", facingMode: "environment" };

    expect(policy.selectVideoInputDevices([device])).toEqual([device]);
    expect(policy.createMediaStreamConstraints(device, IDCARD_CAMERA_PREFERRED_RESOLUTION)).toEqual(
      expect.objectContaining({
        video: expect.not.objectContaining({ deviceId: expect.anything() }),
      }),
    );
  });

  it("데스크톱 호환 후보와 실제 장치 ID가 다르면 invalid다", () => {
    const stream = createStream({ deviceId: "wide", facingMode: "environment", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        devices: [{ deviceId: "wide", label: "Back Ultra Wide Camera", facingMode: "environment" }],
        requestedDevice: { deviceId: "front", label: "Front Camera", facingMode: "user" },
      }),
    ).toEqual({
      valid: false,
      settings: { deviceId: "wide", facingMode: "environment", width: 1920, height: 1080 },
    });
  });

  it("데스크톱 호환 후보의 실제 장치 ID를 확인할 수 없으면 invalid다", () => {
    const stream = createStream({ facingMode: "user", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        requestedDevice: { deviceId: "front", label: "Front Camera", facingMode: "user" },
      }),
    ).toEqual({
      valid: false,
      settings: { facingMode: "user", width: 1920, height: 1080 },
    });
  });

  it("데스크톱 호환 후보의 요청 장치 ID가 없으면 invalid다", () => {
    const stream = createStream({ deviceId: "actual", facingMode: "user", width: 1920, height: 1080 });

    expect(
      policy.validateStream(stream, {
        requestedDevice: { deviceId: "", label: "Front Camera", facingMode: "user" },
      }),
    ).toEqual({
      valid: false,
      settings: { deviceId: "actual", facingMode: "user", width: 1920, height: 1080 },
    });
  });

  it("모바일 strict는 실제 장치 ID가 없어도 방향 정보 미제공 호환성을 유지한다", () => {
    const stream = createStream({ width: 1280, height: 720 });

    expect(
      policy.validateStream(stream, {
        requestedDevice: { deviceId: "unknown", label: "Unknown Camera" },
        requireEnvironmentCamera: true,
      }),
    ).toEqual({
      valid: true,
      settings: { width: 1280, height: 720 },
    });
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
