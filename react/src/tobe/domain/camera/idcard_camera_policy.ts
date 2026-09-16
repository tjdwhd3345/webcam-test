import type { CameraDeviceInfo, CameraFacingMode } from "@tobe/lib/auth/types/camera";

export type IdcardCameraTarget = "idcard_front" | "idcard_back";
export type IdcardCameraResolutionAttempt = "preferred" | "fallback";
export type IdcardCameraFacingAssessment = "environment" | "user" | "unknown";
export type IdcardCameraSelectionReason = "verified_environment" | "unknown_compatibility" | "default_compatibility";
export type IdcardCameraDeviceSelectionReason =
  | "verified_environment"
  | "mobile_unknown_compatibility"
  | "desktop_user_compatibility"
  | "desktop_unknown_compatibility"
  | "excluded_by_label"
  | "excluded_by_zoom_min"
  | "environment_candidate_preferred"
  | "front_camera_not_allowed"
  | "missing_device_id";

export interface IdcardCameraDeviceSelectionDecision {
  device: CameraDeviceInfo;
  facingAssessment: IdcardCameraFacingAssessment;
  passed: boolean;
  reasons: IdcardCameraDeviceSelectionReason[];
}

export interface IdcardCameraResolution {
  attempt: IdcardCameraResolutionAttempt;
  width: number;
  height: number;
}

export interface IdcardCameraValidationResult {
  valid: boolean;
  settings: MediaTrackSettings;
}

export interface IdcardCameraValidationInput {
  devices?: CameraDeviceInfo[];
  requestedDevice?: CameraDeviceInfo | null;
  requireEnvironmentCamera?: boolean;
}

type ExtendedMediaTrackConstraints = MediaTrackConstraints & {
  focusMode?: { ideal: "continuous" | "single-shot" | "manual" };
  whiteBalanceMode?: { ideal: "continuous" | "single-shot" | "manual" };
  zoom?: { ideal: number };
};

const EXCLUDED_CAMERA_LABEL_PATTERN = /ultra|울트라|wide|와이드|광각|tele|망원|triple|트리플/i;
// iOS/WebKit의 Triple 논리 장치는 zoom 1 화각을 유지하면서 근접 시 구성 렌즈를 전환할 수 있다.
const ADAPTIVE_VIRTUAL_CAMERA_LABEL_PATTERN = /triple|트리플/i;

export const IDCARD_CAMERA_PREFERRED_RESOLUTION: IdcardCameraResolution = {
  attempt: "preferred",
  width: 1920,
  height: 1080,
};

export const IDCARD_CAMERA_FALLBACK_RESOLUTION: IdcardCameraResolution = {
  attempt: "fallback",
  width: 1280,
  height: 720,
};

export const IDCARD_CAMERA_MINIMUM_RESOLUTION = IDCARD_CAMERA_FALLBACK_RESOLUTION;

export class IdcardCameraPolicy {
  public readonly preferredFacingMode: CameraFacingMode = "environment";

  public getResolutionCandidates(): IdcardCameraResolution[] {
    return [IDCARD_CAMERA_PREFERRED_RESOLUTION, IDCARD_CAMERA_FALLBACK_RESOLUTION];
  }

  public selectVideoInputDevices(devices: CameraDeviceInfo[], requireEnvironmentCamera = false): CameraDeviceInfo[] {
    return this.evaluateVideoInputDevices(devices, requireEnvironmentCamera)
      .filter(({ passed }) => passed)
      .map(({ device }) => device);
  }

  public evaluateVideoInputDevices(devices: CameraDeviceInfo[], requireEnvironmentCamera = false): IdcardCameraDeviceSelectionDecision[] {
    const assessedDevices = devices.map((device) => ({
      device,
      facingAssessment: this.assessDeviceFacing(device),
      exclusionReasons: this.getCameraExclusionReasons(device),
    }));
    const hasEnvironmentCandidate = assessedDevices.some(
      ({ device, facingAssessment, exclusionReasons }) => facingAssessment === "environment" && exclusionReasons.length === 0 && (!requireEnvironmentCamera || !!device.deviceId),
    );

    return assessedDevices.map(({ device, facingAssessment, exclusionReasons }) => {
      if (exclusionReasons.length > 0) {
        return { device, facingAssessment, passed: false, reasons: exclusionReasons };
      }

      if (requireEnvironmentCamera && !device.deviceId) {
        return { device, facingAssessment, passed: false, reasons: ["missing_device_id"] };
      }

      if (hasEnvironmentCandidate) {
        return facingAssessment === "environment"
          ? { device, facingAssessment, passed: true, reasons: ["verified_environment"] }
          : { device, facingAssessment, passed: false, reasons: ["environment_candidate_preferred"] };
      }

      if (requireEnvironmentCamera) {
        return facingAssessment === "unknown"
          ? { device, facingAssessment, passed: true, reasons: ["mobile_unknown_compatibility"] }
          : { device, facingAssessment, passed: false, reasons: ["front_camera_not_allowed"] };
      }

      if (!device.deviceId) {
        return { device, facingAssessment, passed: false, reasons: ["missing_device_id"] };
      }

      return facingAssessment === "user"
        ? { device, facingAssessment, passed: true, reasons: ["desktop_user_compatibility"] }
        : { device, facingAssessment, passed: true, reasons: ["desktop_unknown_compatibility"] };
    });
  }

  public selectPreferredDevice(devices: CameraDeviceInfo[]): CameraDeviceInfo | null {
    return devices.map((device, index) => ({ device, index })).sort((a, b) => this.compareEnvironmentCameraPriority(a, b))[0]?.device ?? null;
  }

  public getSelectionReason(device: CameraDeviceInfo | null, requireEnvironmentCamera = false): IdcardCameraSelectionReason {
    if (!requireEnvironmentCamera) return "default_compatibility";

    return this.assessDeviceFacing(device) === "environment" ? "verified_environment" : "unknown_compatibility";
  }

  public createPermissionConstraints(): MediaStreamConstraints {
    return {
      video: true,
      audio: false,
    };
  }

  public createMediaStreamConstraints(device: CameraDeviceInfo | null, resolution: IdcardCameraResolution, requireEnvironmentCamera = false): MediaStreamConstraints {
    const video: ExtendedMediaTrackConstraints = {
      width: { ideal: resolution.width, min: resolution.width },
      height: { ideal: resolution.height, min: resolution.height },
      facingMode: { ideal: this.preferredFacingMode },
      focusMode: { ideal: "continuous" },
      whiteBalanceMode: { ideal: "continuous" },
      zoom: { ideal: 1 },
    };

    if (device?.deviceId) {
      const requireSelectedDevice = requireEnvironmentCamera || this.assessDeviceFacing(device) !== "environment";
      video.deviceId = requireSelectedDevice ? { exact: device.deviceId } : { ideal: device.deviceId };
    }

    return {
      video,
      audio: false,
    };
  }

  public assessStreamFacing(settings: MediaTrackSettings, devices: CameraDeviceInfo[] = [], requestedDevice: CameraDeviceInfo | null = null): IdcardCameraFacingAssessment {
    const settingsAssessment = this.assessFacingMode(settings.facingMode);
    const actualDevice = this.findSelectedDevice(devices, settings);
    const actualDeviceAssessment = this.assessDeviceFacing(actualDevice);

    if (settingsAssessment === "user" || actualDeviceAssessment === "user") return "user";
    if (settingsAssessment === "environment" || actualDeviceAssessment === "environment") return "environment";

    return this.assessDeviceFacing(requestedDevice);
  }

  public validateStream(stream: MediaStream, input: IdcardCameraValidationInput = {}): IdcardCameraValidationResult {
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings?.() ?? {};
    const facingAssessment = this.assessStreamFacing(settings, input.devices, input.requestedDevice);
    const isDesktopCompatibilityFallback = input.requireEnvironmentCamera !== true && !!input.requestedDevice && this.assessDeviceFacing(input.requestedDevice) !== "environment";
    const hasMatchingDeviceId = isDesktopCompatibilityFallback
      ? !!input.requestedDevice?.deviceId && !!settings.deviceId && settings.deviceId === input.requestedDevice.deviceId
      : !input.requireEnvironmentCamera || !input.requestedDevice?.deviceId || !settings.deviceId || settings.deviceId === input.requestedDevice.deviceId;
    const valid =
      !!videoTrack && videoTrack.readyState === "live" && this.satisfiesMinimumResolution(settings) && hasMatchingDeviceId && (!input.requireEnvironmentCamera || facingAssessment !== "user");

    return { valid, settings };
  }

  public findSelectedDevice(devices: CameraDeviceInfo[], settings: MediaTrackSettings): CameraDeviceInfo | null {
    if (!settings.deviceId) return null;
    return devices.find((device) => device.deviceId === settings.deviceId) ?? null;
  }

  private assessDeviceFacing(device: CameraDeviceInfo | null): IdcardCameraFacingAssessment {
    return this.assessFacingMode(device?.facingMode);
  }

  private assessFacingMode(facingMode: string | undefined): IdcardCameraFacingAssessment {
    if (facingMode === "environment") return "environment";
    if (facingMode === "user") return "user";

    return "unknown";
  }

  private getCameraExclusionReasons(device: CameraDeviceInfo): IdcardCameraDeviceSelectionReason[] {
    const zoomMin = (device.capabilities as { zoom?: { min?: number } } | undefined)?.zoom?.min;
    const isAdaptiveVirtualCamera = this.isAdaptiveVirtualCamera(device);
    const reasons: IdcardCameraDeviceSelectionReason[] = [];

    if (!isAdaptiveVirtualCamera && EXCLUDED_CAMERA_LABEL_PATTERN.test(device.label)) {
      reasons.push("excluded_by_label");
    }

    if (!isAdaptiveVirtualCamera && typeof zoomMin === "number" && zoomMin < 1) {
      reasons.push("excluded_by_zoom_min");
    }

    return reasons;
  }

  private isAdaptiveVirtualCamera(device: CameraDeviceInfo): boolean {
    const zoom = (device.capabilities as { zoom?: { min?: number; max?: number } } | undefined)?.zoom;

    return (
      this.assessDeviceFacing(device) === "environment" &&
      ADAPTIVE_VIRTUAL_CAMERA_LABEL_PATTERN.test(device.label) &&
      typeof zoom?.min === "number" &&
      typeof zoom.max === "number" &&
      zoom.min <= 1 &&
      zoom.max >= 1
    );
  }

  private getFacingBackIndex(label: string): number | null {
    const match = label.match(/^Facing\s+back\s*:\s*(\d+)$/i) ?? label.match(/^camera\s+(\d+)\s*,\s*facing\s+back$/i);
    return match ? Number(match[1]) : null;
  }

  private compareEnvironmentCameraPriority(a: { device: CameraDeviceInfo; index: number }, b: { device: CameraDeviceInfo; index: number }): number {
    const aFacingBackIndex = this.getFacingBackIndex(a.device.label);
    const bFacingBackIndex = this.getFacingBackIndex(b.device.label);

    if (aFacingBackIndex !== null && bFacingBackIndex !== null) {
      return aFacingBackIndex - bFacingBackIndex;
    }

    if (aFacingBackIndex !== null) return -1;
    if (bFacingBackIndex !== null) return 1;

    const aIsAdaptiveVirtualCamera = this.isAdaptiveVirtualCamera(a.device);
    const bIsAdaptiveVirtualCamera = this.isAdaptiveVirtualCamera(b.device);

    if (aIsAdaptiveVirtualCamera !== bIsAdaptiveVirtualCamera) {
      return aIsAdaptiveVirtualCamera ? -1 : 1;
    }

    return b.index - a.index;
  }

  private satisfiesMinimumResolution(settings: MediaTrackSettings): boolean {
    if (typeof settings.width !== "number" || typeof settings.height !== "number") return false;

    const actualLongSide = Math.max(settings.width, settings.height);
    const actualShortSide = Math.min(settings.width, settings.height);
    const minimumLongSide = Math.max(IDCARD_CAMERA_MINIMUM_RESOLUTION.width, IDCARD_CAMERA_MINIMUM_RESOLUTION.height);
    const minimumShortSide = Math.min(IDCARD_CAMERA_MINIMUM_RESOLUTION.width, IDCARD_CAMERA_MINIMUM_RESOLUTION.height);

    return actualLongSide >= minimumLongSide && actualShortSide >= minimumShortSide;
  }
}
