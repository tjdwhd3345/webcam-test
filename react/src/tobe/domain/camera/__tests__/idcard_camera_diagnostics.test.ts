import { describe, expect, it } from "vitest";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { maskCameraDeviceId, summarizeCameraDevice, summarizeCameraError, summarizeCameraSettings, summarizeMediaStreamConstraints } from "../idcard_camera_diagnostics";

describe("idcard camera diagnostics", () => {
  it("장치 방향과 지원 해상도 범위를 식별 가능 정보 없이 요약한다", () => {
    const rawDeviceId = "sensitive-camera-device-id";
    const device: CameraDeviceInfo = {
      deviceId: rawDeviceId,
      label: "Back Camera",
      facingMode: "environment",
      capabilities: {
        width: { min: 640, max: 3840 },
        height: { min: 480, max: 2160 },
        zoom: { min: 1, max: 10 },
      } as MediaTrackCapabilities,
    };

    const summary = summarizeCameraDevice(device, 2);

    expect(summary).toEqual({
      index: 2,
      deviceId: maskCameraDeviceId(rawDeviceId),
      label: "Back Camera",
      facingMode: "environment",
      environment: true,
      width: { min: 640, max: 3840 },
      height: { min: 480, max: 2160 },
      zoom: { min: 1, max: 10 },
    });
    expect(summary.deviceId).not.toContain(rawDeviceId);
  });

  it("방향과 실제 해상도를 제공하지 않는 settings는 unknown으로 구분한다", () => {
    expect(summarizeCameraSettings({ deviceId: "camera-id" })).toEqual({
      deviceId: maskCameraDeviceId("camera-id"),
      facingMode: "unknown",
      environment: null,
      width: null,
      height: null,
    });
  });

  it("브라우저가 반환한 비표준 facingMode 문자열은 실제 값 그대로 보존한다", () => {
    expect(summarizeCameraSettings({ facingMode: "left", width: 1280, height: 720 })).toEqual({
      deviceId: null,
      facingMode: "left",
      environment: null,
      width: 1280,
      height: 720,
    });
  });

  it("getUserMedia constraints의 deviceId만 일관된 익명 값으로 치환한다", () => {
    const rawDeviceId = "sensitive-camera-device-id";
    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: { exact: rawDeviceId },
        facingMode: { ideal: "environment" },
        width: { ideal: 1920, min: 1920 },
        height: { ideal: 1080, min: 1080 },
      },
      audio: false,
    };

    expect(summarizeMediaStreamConstraints(constraints)).toEqual({
      video: {
        deviceId: { exact: maskCameraDeviceId(rawDeviceId) },
        facingMode: { ideal: "environment" },
        width: { ideal: 1920, min: 1920 },
        height: { ideal: 1080, min: 1080 },
      },
      audio: false,
    });
  });

  it("오류 원문은 제외하고 name과 constraint만 요약한다", () => {
    const error = new Error("sensitive browser error") as Error & { constraint: string };
    error.name = "OverconstrainedError";
    error.constraint = "width";

    expect(summarizeCameraError(error)).toEqual({ name: "OverconstrainedError", constraint: "width" });
  });
});
