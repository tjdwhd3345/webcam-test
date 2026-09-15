/**
 * Camera Service Types
 * React + TypeScript 기반 카메라 스트림 관리를 위한 타입 정의
 */

// 카메라 방향 타입
export type CameraFacingMode = "user" | "environment";

// 카메라 에러 타입
export type CameraErrorType =
  | "NotAllowedError" // 권한 거부
  | "NotFoundError" // 카메라 디바이스 없음
  | "NotReadableError" // 하드웨어 오류
  | "OverconstrainedError" // 제약 조건 만족 불가
  | "AbortError" // 사용자 중단
  | "TypeError" // 타입 오류
  | "Unknown"; // 알 수 없는 오류

// 플랫폼 정보 타입 (기존 코드 기반)
export interface PlatformInfo {
  isWebViewAndroidReactNative?: boolean;
  isWebviewAndroid?: boolean;
  isMobile?: boolean;
  isIOS?: boolean;
  isAndroid?: boolean;
}

// 카메라 제약 조건 옵션
export interface CameraConstraints {
  facingMode?: CameraFacingMode;
  width?: number | { ideal?: number; min?: number; max?: number };
  height?: number | { ideal?: number; min?: number; max?: number };
  deviceId?: string | { ideal?: string };
  frameRate?: number | { ideal?: number; min?: number; max?: number };
  focusMode?: "continuous" | "single-shot" | "manual";
  whiteBalanceMode?: "continuous" | "single-shot" | "manual";
  zoom?: number | { ideal?: number; min?: number; max?: number };
}

// 카메라 스트림 옵션
export interface CameraStreamOptions {
  video?: boolean | CameraConstraints;
  audio?: boolean;
  platform?: PlatformInfo;
  retryCount?: number;
  retryDelay?: number;
}

// 카메라 디바이스 정보
export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  facingMode?: CameraFacingMode;
  capabilities?: MediaTrackCapabilities;
}

// 카메라 에러 정보
export interface CameraError {
  type: CameraErrorType;
  message: string;
  originalError?: Error;
  code?: string;
}

// 카메라 스트림 상태
export interface CameraStreamState {
  stream: MediaStream | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: CameraError | null;
  permissionDenied: boolean;
  devices: CameraDeviceInfo[];
  currentDevice: CameraDeviceInfo | null;
}

// 카메라 스트림 액션
export interface CameraStreamActions {
  startStream: (options?: CameraStreamOptions) => Promise<void>;
  stopStream: () => void;
  retryStream: () => Promise<void>;
  switchCamera: (deviceId?: string) => Promise<void>;
  getDevices: () => Promise<CameraDeviceInfo[]>;
  checkPermission: () => Promise<PermissionState>;
}

// Custom Hook 반환 타입
export interface UseCameraStreamReturn extends CameraStreamState, CameraStreamActions {}

// 카메라 설정 프리셋
export interface CameraPresets {
  idCard: CameraStreamOptions;
  face: CameraStreamOptions;
  document: CameraStreamOptions;
  default: CameraStreamOptions;
}

// 카메라 이벤트 타입
export type CameraEvent =
  | { type: "stream-started"; stream: MediaStream }
  | { type: "stream-stopped" }
  | { type: "error"; error: CameraError }
  | { type: "permission-denied" }
  | { type: "device-changed"; device: CameraDeviceInfo };

// 카메라 이벤트 리스너
export type CameraEventListener = (event: CameraEvent) => void;

// 카메라 서비스 인터페이스
export interface ICameraService {
  startStream(options?: CameraStreamOptions): Promise<MediaStream>;
  stopStream(): void;
  getDevices(): Promise<CameraDeviceInfo[]>;
  checkPermission(): Promise<PermissionState>;
  addEventListener(listener: CameraEventListener): void;
  removeEventListener(listener: CameraEventListener): void;
}
