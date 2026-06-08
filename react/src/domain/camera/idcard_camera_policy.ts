import { CameraDeviceInfo, CameraFacingMode } from "@lib/auth/types/camera";

export type IdcardCameraTarget = "idcard_front" | "idcard_back";
export type IdcardCameraResolutionAttempt = "preferred" | "fallback";

export interface IdcardCameraResolution {
  attempt: IdcardCameraResolutionAttempt;
  width: number;
  height: number;
}

export interface IdcardCameraValidationResult {
  valid: boolean;
  settings: MediaTrackSettings;
}

type ExtendedMediaTrackConstraints = MediaTrackConstraints & {
  focusMode?: { ideal: "continuous" | "single-shot" | "manual" };
  whiteBalanceMode?: { ideal: "continuous" | "single-shot" | "manual" };
  zoom?: { ideal: number };
};

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

  public selectVideoInputDevices(devices: CameraDeviceInfo[]): CameraDeviceInfo[] {
    return devices.filter((device) => {
      return device.facingMode === this.preferredFacingMode && !this.isExcludedEnvironmentCamera(device);
      // return !this.isExcludedEnvironmentCamera(device.label);
    });
  }

  public selectPreferredDevice(devices: CameraDeviceInfo[]): CameraDeviceInfo | null {
    return devices
      .map((device, index) => ({ device, index }))
      .sort((a, b) => this.compareEnvironmentCameraPriority(a, b))[0]?.device ?? null;
  }

  public createPermissionConstraints(): MediaStreamConstraints {
    return {
      // video: {
      //   facingMode: { ideal: this.preferredFacingMode },
      // },
      video: true,
      audio: false,
    };
  }

  public createMediaStreamConstraints(device: CameraDeviceInfo | null, resolution: IdcardCameraResolution): MediaStreamConstraints {
    const video: ExtendedMediaTrackConstraints = {
      width: { ideal: resolution.width, min: resolution.width },
      height: { ideal: resolution.height, min: resolution.height },
      facingMode: { ideal: this.preferredFacingMode },
      focusMode: { ideal: "continuous" },
      whiteBalanceMode: { ideal: "continuous" },
      zoom: { ideal: 1 },
    };

    if (device?.deviceId) {
      video.deviceId = { ideal: device.deviceId };
    }

    return {
      video,
      audio: false,
    };
  }

  public validateStream(stream: MediaStream): IdcardCameraValidationResult {
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings?.() ?? {};
    const valid =
      !!videoTrack &&
      videoTrack.readyState === "live" &&
      this.satisfiesMinimumResolution(settings);

    return { valid, settings };
  }

  public findSelectedDevice(devices: CameraDeviceInfo[], settings: MediaTrackSettings): CameraDeviceInfo | null {
    if (!settings.deviceId) return null;
    return devices.find((device) => device.deviceId === settings.deviceId) ?? null;
  }

  private isExcludedEnvironmentCamera(device: CameraDeviceInfo): boolean {
    const zoomMin = (device.capabilities as { zoom?: { min?: number } } | undefined)?.zoom?.min;

    return /ultra|울트라|wide|와이드|광각|tele|망원|triple|트리플/i.test(device.label) || (typeof zoomMin === "number" && zoomMin < 1);
  }

  private getFacingBackIndex(label: string): number | null {
    const match = label.match(/^Facing\s+back\s*:\s*(\d+)$/i);
    return match ? Number(match[1]) : null;
  }

  private compareEnvironmentCameraPriority(
    a: { device: CameraDeviceInfo; index: number },
    b: { device: CameraDeviceInfo; index: number },
  ): number {
    const aFacingBackIndex = this.getFacingBackIndex(a.device.label);
    const bFacingBackIndex = this.getFacingBackIndex(b.device.label);

    if (aFacingBackIndex !== null && bFacingBackIndex !== null) {
      return aFacingBackIndex - bFacingBackIndex;
    }

    if (aFacingBackIndex !== null) return -1;
    if (bFacingBackIndex !== null) return 1;

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
