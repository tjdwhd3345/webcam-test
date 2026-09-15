/**
 * Camera Utility Functions
 * 카메라 관련 순수 함수들의 집합
 */

import type {
  CameraConstraints,
  CameraDeviceInfo,
  CameraError,
  CameraErrorType,
  CameraFacingMode,
  CameraPresets,
  PlatformInfo,
} from "../types/camera";

export const CAMERA_PRIMARY_RESOLUTION = {
  width: 1920,
  height: 1080,
} as const;

export const CAMERA_FALLBACK_RESOLUTION = {
  width: 1280,
  height: 720,
} as const;

type CameraResolution = typeof CAMERA_PRIMARY_RESOLUTION | typeof CAMERA_FALLBACK_RESOLUTION;

export const maskCameraDeviceId = (deviceId?: string | null): string | undefined => {
  if (!deviceId) return undefined;
  if (deviceId.length <= 8) return "***";
  return `${deviceId.slice(0, 4)}...${deviceId.slice(-4)}`;
};

const sanitizeCameraDebugValue = (value: unknown, key?: string): unknown => {
  if (key === "deviceId" || key === "groupId") {
    if (typeof value === "string") return maskCameraDeviceId(value);
    if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? maskCameraDeviceId(item) : sanitizeCameraDebugValue(item)));
  }

  if (Array.isArray(value)) return value.map((item) => sanitizeCameraDebugValue(item));

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitizeCameraDebugValue(entryValue, entryKey)]));
  }

  return value;
};

export const summarizeCameraConstraints = (constraints: MediaStreamConstraints | CameraConstraints): Record<string, unknown> => {
  return sanitizeCameraDebugValue(constraints) as Record<string, unknown>;
};

export const summarizeCameraTrack = (stream: MediaStream | null): Record<string, unknown> | null => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;

  const getTrackCapabilities = () => {
    try {
      return typeof track.getCapabilities === "function" ? track.getCapabilities() : undefined;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "unknown" };
    }
  };

  return {
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    settings: sanitizeCameraDebugValue(track.getSettings?.() || {}),
    capabilities: sanitizeCameraDebugValue(getTrackCapabilities() || {}),
  };
};

/**
 * 브라우저 에러를 CameraError로 변환
 */
export const mapBrowserErrorToCameraError = (error: Error): CameraError => {
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
    message: errorMessages[errorType] || errorMessages["Unknown"],
    originalError: error,
  };
};

const getVideoDeviceCapabilitiesOnIOS16Lower = async (deviceId: string) => {
  // 1) 권한 확보 (권한 없으면 capabilities가 비거나, label/device 접근이 제한될 수 있음)
  const warmup = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  warmup.getTracks().forEach((t) => t.stop());

  // 2) 특정 deviceId로 스트림 열기
  const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });

  try {
    const track = stream.getVideoTracks()[0];

    // 3) capabilities 조회 (iOS 11+ Safari에서 지원으로 잡히는 기능)
    const caps = track.getCapabilities?.();
    const settings = track.getSettings?.();

    return { caps, settings };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
};

const checkIOSCameraDeviceView = (deviceLabel: string, cameraDevicesViewInfo: { isUltra: boolean; isTele: boolean; isDual: boolean; isTriple: boolean }) => {
  const isUltra = /ultra|울트라/gi.test(deviceLabel);
  const isTele = /tele|망원/gi.test(deviceLabel);
  const isDual = /dual|듀얼/gi.test(deviceLabel);
  const isTriple = /triple|트리플/gi.test(deviceLabel);

  cameraDevicesViewInfo.isUltra = cameraDevicesViewInfo.isUltra || isUltra;
  cameraDevicesViewInfo.isTele = cameraDevicesViewInfo.isTele || isTele;
  cameraDevicesViewInfo.isTriple = cameraDevicesViewInfo.isTriple || isTriple;
  cameraDevicesViewInfo.isDual = cameraDevicesViewInfo.isDual || isDual;

  return {
    isUltra,
    isTele,
    isDual,
    isTriple,
  };
};

/**
 * 미디어 디바이스 목록에서 카메라 디바이스만 추출
 */
export const extractCameraDevices = async (): Promise<CameraDeviceInfo[]> => {
  try {
    // iOS에서 첫 요청 시 미디어 디바이스 정보를 가져오지 못함.
    const warmup = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    warmup.getTracks().forEach((t) => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();

    const cameras: CameraDeviceInfo[] = [];

    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    const cameraDevicesViewInfo = { isUltra: false, isTele: false, isDual: false, isTriple: false };

    for (const device of videoDevices) {
      if ("getCapabilities" in device) {
        // 안드로이드 or iOS 17 이상
        const caps = (device as InputDeviceInfo).getCapabilities();
        if (caps?.facingMode?.includes("environment")) {
          if ((caps as { zoom: { min: number } })?.zoom?.min < 1) continue; // iOS에서만 zoom이 있음
          const cameraDeviceView = checkIOSCameraDeviceView(device.label?.toLowerCase(), cameraDevicesViewInfo);
          if (
            cameraDeviceView.isUltra ||
            cameraDeviceView.isTele ||
            cameraDeviceView.isTriple
            // || cameraDeviceLabel.isDual // 듀얼 카메라가 모두 광각은 아님. 오히려 자동초점이 되는 일반카메라일 수 있음.
          )
            continue;

          cameras.push({
            deviceId: caps.deviceId || "",
            label: device.label,
            facingMode: caps?.facingMode?.includes("environment") ? "environment" : "user",
            capabilities: caps,
          });
        }
      } else {
        // iOS 16 이하
        const { caps, settings } = await getVideoDeviceCapabilitiesOnIOS16Lower(device.deviceId);
        if (caps?.facingMode?.includes("environment")) {
          if ((settings?.zoom || 1) < 1) continue;
          const cameraDeviceView = checkIOSCameraDeviceView(device.label?.toLowerCase(), cameraDevicesViewInfo);
          if (
            cameraDeviceView.isUltra ||
            cameraDeviceView.isTele ||
            cameraDeviceView.isTriple
            // || cameraDeviceLabel.isDual // 듀얼 카메라가 모두 광각은 아님. 오히려 자동초점이 되는 일반카메라일 수 있음.
          )
            continue;

          cameras.push({
            deviceId: caps.deviceId || "",
            label: device.label,
            facingMode: caps?.facingMode?.includes("environment") ? "environment" : "user",
            capabilities: caps,
          });
        }
      }
    }

    return cameras;
  } catch (error) {
    console.error("Failed to enumerate camera devices:", error);
    return [];
  }
};

/**
 * 원하는 facing mode의 카메라 디바이스 찾기
 */
export const findCameraByFacingMode = (devices: CameraDeviceInfo[], facingMode: CameraFacingMode): CameraDeviceInfo | null => {
  return devices.find((device) => device.facingMode === facingMode) || null;
};

export const applyCameraResolution = (constraints: CameraConstraints, resolution: CameraResolution): CameraConstraints => ({
  ...constraints,
  width: { ideal: resolution.width, min: resolution.width },
  height: { ideal: resolution.height, min: resolution.height },
});

export const isOverconstrainedError = (error: unknown): boolean => {
  return (error as { name?: string } | undefined)?.name === "OverconstrainedError";
};

export const isWidthHeightOverconstrainedError = (error: unknown): boolean => {
  const constraint = (error as { constraint?: string } | undefined)?.constraint;

  return isOverconstrainedError(error) && (constraint === "width" || constraint === "height");
};

/**
 * 플랫폼에 맞는 카메라 제약 조건 생성
 */
export const createCameraConstraints = (constraints: CameraConstraints, platform?: PlatformInfo, availableDevices: CameraDeviceInfo[] = []): MediaStreamConstraints => {
  const {
    facingMode = "environment",
    width = { ideal: 1920 },
    height = { ideal: 1080 },
    deviceId,
    frameRate,
    focusMode = "continuous",
    whiteBalanceMode = "continuous",
    zoom = { ideal: 1 },
  } = constraints;

  // 사용 가능한 카메라 디바이스 필터링
  const targetDevices = availableDevices.filter((device) => device.facingMode === facingMode);

  // 디바이스 Id 결정
  let finalDeviceId = deviceId as string;
  if (!finalDeviceId && targetDevices.length > 0) {
    // Android WebView의 경우 마지막 디바이스 선택
    if (platform?.isWebViewAndroidReactNative || platform?.isWebviewAndroid) {
      finalDeviceId = targetDevices[targetDevices.length - 1]?.deviceId;
    } else {
      finalDeviceId = targetDevices[targetDevices.length - 1]?.deviceId;
    }
  }

  const videoConstraints: MediaTrackConstraints = {
    ...(finalDeviceId && { deviceId: { ideal: finalDeviceId } }),
    width,
    height,
    facingMode: { ideal: facingMode },
    ...(frameRate && { frameRate }),
    ...(focusMode && { focusMode: { ideal: focusMode } }),
    ...(whiteBalanceMode && { whiteBalanceMode: { ideal: whiteBalanceMode } }),
    ...(zoom && { zoom }),
  };

  return {
    video: videoConstraints,
    audio: false,
  };
};

/**
 * 카메라 권한 상태 확인
 */
export const checkCameraPermission = async (): Promise<PermissionState> => {
  if (!navigator.permissions) {
    throw new Error("Permissions API is not supported");
  }

  try {
    const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
    return permission.state;
  } catch (error) {
    console.error("Failed to check camera permission:", error);
    return "prompt";
  }
};

/**
 * 미디어 스트림 검증
 */
export const validateMediaStream = (stream: MediaStream): boolean => {
  if (!stream) return false;

  const videoTracks = stream.getVideoTracks();
  return videoTracks.length > 0 && videoTracks[0].readyState === "live";
};

/**
 * 미디어 스트림 정리
 */
export const cleanupMediaStream = (stream: MediaStream | null): void => {
  if (!stream) return;

  try {
    // 모든 트랙 중지
    stream.getTracks().forEach((track) => {
      track.stop();
    });

    // 스트림 정리 (일부 브라우저에서 지원)
    if ("stop" in stream && typeof stream.stop === "function") {
      (stream as any).stop();
    }
  } catch (error) {
    console.error("Failed to cleanup media stream:", error);
  }
};

/**
 * 카메라 설정 프리셋
 */
export const getCameraPresets = (): CameraPresets => ({
  // 신분증 촬영용 설정
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

  // 얼굴 촬영용 설정
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

  // 문서 촬영용 설정
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

  // 기본 설정
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

/**
 * 디바이스 타입별 최적 설정 가져오기
 */
export const getOptimalSettingsForPlatform = (platform: PlatformInfo, preset: keyof CameraPresets = "default"): CameraConstraints => {
  const presets = getCameraPresets();
  const baseSettings = presets[preset].video as CameraConstraints;

  if (platform.isMobile) {
    // 모바일 최적화
    return {
      ...baseSettings,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
  }

  if (platform.isWebViewAndroidReactNative || platform.isWebviewAndroid) {
    // Android WebView 최적화
    return {
      ...baseSettings,
      frameRate: { ideal: 30, max: 30 },
    };
  }

  return baseSettings;
};

/**
 * 재시도 로직을 위한 지연 함수
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * 사용자 에이전트에서 플랫폼 정보 추출
 */
export const detectPlatform = (): PlatformInfo => {
  const userAgent = navigator.userAgent.toLowerCase();

  return {
    isMobile: /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent),
    isIOS: /iphone|ipad|ipod/i.test(userAgent),
    isAndroid: /android/i.test(userAgent),
    isWebviewAndroid: userAgent.includes("wv") && userAgent.includes("android"),
    isWebViewAndroidReactNative: userAgent.includes("reactnative"),
  };
};
