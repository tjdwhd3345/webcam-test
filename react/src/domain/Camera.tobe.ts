import type { CameraConstraints, CameraDeviceInfo, CameraError, CameraErrorType, CameraFacingMode, CameraPresets, PlatformInfo } from "../types/camera.ts";
import {
  applyCameraResolution,
  CAMERA_FALLBACK_RESOLUTION,
  CAMERA_PRIMARY_RESOLUTION,
  createCameraConstraints,
  getOptimalSettingsForPlatform,
  isWidthHeightOverconstrainedError,
  validateMediaStream,
} from "../lib/camera_utils.ts";

type CameraDeviceViewInfo = {
  isUltra: boolean;
  isTele: boolean;
  isDual: boolean;
  isTriple: boolean;
};

export const CAMERA_PRIMARY_RESOLUTION_TOBE = CAMERA_PRIMARY_RESOLUTION;
export const CAMERA_FALLBACK_RESOLUTION_TOBE = CAMERA_FALLBACK_RESOLUTION;

export const applyCameraResolutionTobe = applyCameraResolution;
export const createCameraConstraintsTobe = createCameraConstraints;
export const getOptimalSettingsForPlatformTobe = getOptimalSettingsForPlatform;
export const isWidthHeightOverconstrainedErrorTobe = isWidthHeightOverconstrainedError;
export const validateMediaStreamTobe = validateMediaStream;

export const createCameraDeviceViewInfo = (): CameraDeviceViewInfo => ({
  isUltra: false,
  isTele: false,
  isDual: false,
  isTriple: false,
});

export const detectPlatformTobe = (userAgent: string): PlatformInfo => {
  const normalizedUserAgent = userAgent.toLowerCase();

  return {
    isMobile: /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(normalizedUserAgent),
    isIOS: /iphone|ipad|ipod/i.test(normalizedUserAgent),
    isAndroid: /android/i.test(normalizedUserAgent),
    isWebviewAndroid: normalizedUserAgent.includes("wv") && normalizedUserAgent.includes("android"),
    isWebViewAndroidReactNative: normalizedUserAgent.includes("reactnative"),
  };
};

export const isCameraErrorTobe = (error: unknown): error is CameraError => {
  return !!error && typeof error === "object" && "type" in error && "message" in error;
};

export const mapBrowserErrorToCameraErrorTobe = (error: Error): CameraError => {
  const errorType = error.name as CameraErrorType;

  const errorMessages: Record<CameraErrorType, string> = {
    NotAllowedError: "카메라 사용 권한이 거부되었습니다.",
    NotFoundError: "카메라 디바이스를 찾을 수 없습니다.",
    NotReadableError: "카메라 하드웨어 오류가 발생했습니다.",
    OverconstrainedError: "요청한 카메라 설정을 지원하지 않습니다.",
    AbortError: "카메라 요청이 중단되었습니다.",
    TypeError: "잘못된 카메라 설정입니다.",
    Unknown: "알 수 없는 카메라 오류가 발생했습니다.",
  };

  return {
    type: Object.keys(errorMessages).includes(errorType) ? errorType : "Unknown",
    message: errorMessages[errorType] || errorMessages.Unknown,
    originalError: error,
  };
};

export const normalizeCameraDeviceTobe = (device: MediaDeviceInfo, capabilities?: MediaTrackCapabilities): CameraDeviceInfo => ({
  deviceId: capabilities?.deviceId || device.deviceId,
  label: device.label,
  facingMode: resolveFacingModeTobe(device.label, capabilities?.facingMode),
  capabilities,
});

export const shouldUseCameraDeviceTobe = (
  label: string,
  capabilities: MediaTrackCapabilities | undefined,
  cameraDevicesViewInfo: CameraDeviceViewInfo,
  settings?: MediaTrackSettings,
): boolean => {
  const facingMode = resolveFacingModeTobe(label, capabilities?.facingMode ?? (settings?.facingMode ? [settings.facingMode] : undefined));
  if (facingMode !== "environment") return false;

  const zoomMin = (capabilities as { zoom?: { min?: number } } | undefined)?.zoom?.min ?? settings?.zoom;
  if (typeof zoomMin === "number" && zoomMin < 1) return false;

  const viewInfo = checkCameraDeviceViewTobe(label);
  cameraDevicesViewInfo.isUltra = cameraDevicesViewInfo.isUltra || viewInfo.isUltra;
  cameraDevicesViewInfo.isTele = cameraDevicesViewInfo.isTele || viewInfo.isTele;
  cameraDevicesViewInfo.isTriple = cameraDevicesViewInfo.isTriple || viewInfo.isTriple;
  cameraDevicesViewInfo.isDual = cameraDevicesViewInfo.isDual || viewInfo.isDual;

  return !viewInfo.isUltra && !viewInfo.isTele && !viewInfo.isTriple && !/wide|와이드|광각/i.test(label);
};

export const getCameraPresetsTobe = (): CameraPresets => ({
  idCard: {
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
  },
  face: {
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
      focusMode: "continuous",
    },
    audio: false,
    retryCount: 3,
    retryDelay: 1000,
  },
  document: {
    video: {
      facingMode: "environment",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      focusMode: "continuous",
      whiteBalanceMode: "continuous",
    },
    audio: false,
    retryCount: 3,
    retryDelay: 1000,
  },
  default: {
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
    retryCount: 3,
    retryDelay: 1000,
  },
});

const resolveFacingModeTobe = (label: string, facingModes?: string[]): CameraFacingMode | undefined => {
  if (facingModes?.includes("environment")) return "environment";
  if (facingModes?.includes("user")) return "user";
  if (/back|rear|environment|후면/i.test(label)) return "environment";
  if (/front|user|전면/i.test(label)) return "user";
  return undefined;
};

const checkCameraDeviceViewTobe = (label: string) => ({
  isUltra: /ultra|울트라/i.test(label),
  isTele: /tele|망원/i.test(label),
  isDual: /dual|듀얼/i.test(label),
  isTriple: /triple|트리플/i.test(label),
});

export type { CameraConstraints };
