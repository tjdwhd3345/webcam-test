"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraConstraints, CameraDeviceInfo, CameraError, CameraStreamOptions, CameraStreamState, PlatformInfo, UseCameraStreamReturn } from "../types/camera";
import {
  applyCameraResolution,
  CAMERA_FALLBACK_RESOLUTION,
  CAMERA_PRIMARY_RESOLUTION,
  checkCameraPermission,
  cleanupMediaStream,
  createCameraConstraints,
  // delay,
  detectPlatform,
  extractCameraDevices,
  getOptimalSettingsForPlatform,
  isWidthHeightOverconstrainedError,
  mapBrowserErrorToCameraError,
  summarizeCameraConstraints,
  summarizeCameraTrack,
  validateMediaStream,
} from "../lib/camera_utils";

type CameraStreamDebugAttempt = "primary" | "fallback";
type CameraStreamDebugEvent = {
  step: string;
  attempt?: CameraStreamDebugAttempt;
  [key: string]: unknown;
};

const getUserMediaWithResolutionFallback = async (
  cameraConstraints: CameraConstraints,
  platform: PlatformInfo | undefined,
  devices: CameraDeviceInfo[],
  onDebug: (event: CameraStreamDebugEvent) => void,
): Promise<MediaStream> => {
  const primaryConstraints = createCameraConstraints(applyCameraResolution(cameraConstraints, CAMERA_PRIMARY_RESOLUTION), platform, devices);

  try {
    onDebug({
      step: "get-user-media-request",
      attempt: "primary",
      constraints: summarizeCameraConstraints(primaryConstraints),
    });

    const stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
    onDebug({
      step: "get-user-media-success",
      attempt: "primary",
      track: summarizeCameraTrack(stream),
    });
    return stream;
  } catch (error) {
    if (!isWidthHeightOverconstrainedError(error)) throw error;

    onDebug({
      step: "get-user-media-overconstrained-fallback",
      attempt: "primary",
      errorName: error instanceof Error ? error.name : (error as { name?: string } | undefined)?.name,
      errorConstraint: (error as { constraint?: string } | undefined)?.constraint,
    });

    const fallbackConstraints = createCameraConstraints(applyCameraResolution(cameraConstraints, CAMERA_FALLBACK_RESOLUTION), platform, devices);
    onDebug({
      step: "get-user-media-request",
      attempt: "fallback",
      constraints: summarizeCameraConstraints(fallbackConstraints),
    });

    const fallbackStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    onDebug({
      step: "get-user-media-success",
      attempt: "fallback",
      track: summarizeCameraTrack(fallbackStream),
    });
    return fallbackStream;
  }
};

/**
 * 카메라 스트림 관리를 위한 Custom Hook
 */
export const useCameraStream = (initialOptions?: CameraStreamOptions): UseCameraStreamReturn => {
  // State 관리
  const [state, setState] = useState<CameraStreamState>({
    stream: null,
    isLoading: false,
    isStreaming: false,
    error: null,
    permissionDenied: false,
    devices: [],
    currentDevice: null,
  });

  // Refs
  const streamRef = useRef<MediaStream | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeStartPromiseRef = useRef<Promise<void> | null>(null);
  const shouldKeepStreamingRef = useRef(false);
  const lastStreamOptionsRef = useRef<CameraStreamOptions | undefined>(initialOptions);
  const wasPageHiddenRef = useRef(false);
  const streamRequestIdRef = useRef(0);
  const platformRef = useRef<PlatformInfo>(detectPlatform());
  const cameraDebugContextRef = useRef<Record<string, unknown>>({});

  // Options with defaults
  const options = {
    retryCount: 3,
    retryDelay: 1000,
    ...initialOptions,
  };

  const updateState = useCallback((updates: Partial<CameraStreamState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const isCurrentStreamHealthy = useCallback(() => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    return videoTrack?.readyState === "live" && !videoTrack.muted;
  }, []);

  const recordCameraDebug = useCallback((event: CameraStreamDebugEvent) => {
    const previousEvents = Array.isArray(cameraDebugContextRef.current.events) ? (cameraDebugContextRef.current.events as CameraStreamDebugEvent[]) : [];
    const events = [...previousEvents, event].slice(-20);

    cameraDebugContextRef.current = {
      ...cameraDebugContextRef.current,
      lastEvent: event,
      events,
    };
  }, []);

  /**
   * 에러 처리
   */
  const handleError = useCallback(
    (error: Error): CameraError => {
      const cameraError = mapBrowserErrorToCameraError(error);

      updateState({
        error: cameraError,
        isLoading: false,
        permissionDenied: cameraError.type === "NotAllowedError",
      });

      console.error("Camera Error:", cameraError);
      return cameraError;
    },
    [updateState],
  );

  /**
   * 사용 가능한 카메라 디바이스 목록 가져오기
   */
  const getDevices = useCallback(async (): Promise<CameraDeviceInfo[]> => {
    try {
      const devices = await extractCameraDevices();
      updateState({ devices });
      return devices;
    } catch (error) {
      handleError(error as Error);
      return [];
    }
  }, [handleError, updateState]);

  /**
   * 카메라 권한 확인
   */
  const checkPermission = useCallback(async (): Promise<PermissionState> => {
    try {
      return await checkCameraPermission();
    } catch (error) {
      console.warn("Permission check failed:", error);
      return "prompt";
    }
  }, []);

  /**
   * 스트림 정리
   */
  const cleanup = useCallback(
    (cleanupOptions: { keepStreamingIntent?: boolean } = {}) => {
      if (!cleanupOptions.keepStreamingIntent) {
        shouldKeepStreamingRef.current = false;
      }

      streamRequestIdRef.current += 1;
      activeStartPromiseRef.current = null;

      if (streamRef.current) {
        cleanupMediaStream(streamRef.current);
        streamRef.current = null;
      }

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      updateState({
        stream: null,
        isStreaming: false,
        isLoading: false,
      });
    },
    [updateState],
  );

  /**
   * 스트림 시작 (재시도 로직 포함)
   */
  const startStreamWithRetry = useCallback(
    async (streamOptions?: CameraStreamOptions, attempt: number = 1, requestId: number = streamRequestIdRef.current): Promise<void> => {
      const maxAttempts = streamOptions?.retryCount || options.retryCount || 3;
      const retryDelay = streamOptions?.retryDelay || options.retryDelay || 1000;

      try {
        if (requestId !== streamRequestIdRef.current) return;

        updateState({
          isLoading: true,
          error: null,
          permissionDenied: false,
        });

        // 디바이스 목록 가져오기
        const devices = await getDevices();

        if (requestId !== streamRequestIdRef.current) return;

        // 플랫폼 정보 업데이트
        const platform = streamOptions?.platform || platformRef.current;

        // 카메라 제약 조건 생성
        const videoConstraints = streamOptions?.video || getOptimalSettingsForPlatform(platform);
        const cameraConstraints = typeof videoConstraints === "object" ? videoConstraints : {};

        if (attempt === 1) {
          cameraDebugContextRef.current = {};
        }

        recordCameraDebug({
          step: "start-stream",
          streamAttempt: attempt,
          inputCameraConstraints: summarizeCameraConstraints(cameraConstraints),
          platform,
          deviceCount: devices.length,
        });

        // 미디어 스트림 요청
        const stream = await getUserMediaWithResolutionFallback(cameraConstraints, platform, devices, recordCameraDebug);

        if (requestId !== streamRequestIdRef.current) {
          cleanupMediaStream(stream);
          return;
        }

        // 스트림 유효성 검증
        if (!validateMediaStream(stream)) {
          throw new Error("Invalid media stream received");
        }

        // 현재 디바이스 정보 업데이트
        const videoTrack = stream.getVideoTracks()[0];
        const currentDevice = devices.find((device) => device.deviceId === videoTrack.getSettings().deviceId) || null;
        recordCameraDebug({
          step: "stream-ready",
          track: summarizeCameraTrack(stream),
          currentDevice: currentDevice
            ? {
                label: currentDevice.label,
                facingMode: currentDevice.facingMode,
              }
            : null,
        });

        streamRef.current = stream;
        updateState({
          stream,
          isStreaming: true,
          isLoading: false,
          error: null,
          currentDevice,
          devices,
        });
      } catch (error) {
        recordCameraDebug({
          step: "stream-error",
          errorName: error instanceof Error ? error.name : (error as { name?: string } | undefined)?.name,
          errorMessage: error instanceof Error ? error.message : undefined,
          errorConstraint: (error as { constraint?: string } | undefined)?.constraint,
        });
        const cameraError = handleError(error as Error);

        // 재시도 로직
        if (attempt < maxAttempts && cameraError.type !== "NotAllowedError" && cameraError.type !== "OverconstrainedError") {
          console.log(`Camera stream attempt ${attempt} failed, retrying in ${retryDelay}ms...`);

          retryTimeoutRef.current = setTimeout(() => {
            startStreamWithRetry(streamOptions, attempt + 1, requestId);
          }, retryDelay);
        } else {
          updateState({ isLoading: false });
        }
      }
    },
    [getDevices, handleError, recordCameraDebug, updateState, options.retryCount, options.retryDelay],
  );

  /**
   * 스트림 시작
   */
  const startStream = useCallback(
    async (streamOptions?: CameraStreamOptions): Promise<void> => {
      shouldKeepStreamingRef.current = true;
      lastStreamOptionsRef.current = streamOptions;

      if (activeStartPromiseRef.current) {
        return activeStartPromiseRef.current;
      }

      // 기존 스트림이 있다면 정리
      if (streamRef.current) {
        cleanup({ keepStreamingIntent: true });
      }

      const requestId = streamRequestIdRef.current + 1;
      streamRequestIdRef.current = requestId;

      const startPromise = startStreamWithRetry(streamOptions, 1, requestId);
      activeStartPromiseRef.current = startPromise;

      try {
        await startPromise;
      } finally {
        if (activeStartPromiseRef.current === startPromise) {
          activeStartPromiseRef.current = null;
        }
      }
    },
    [cleanup, startStreamWithRetry],
  );

  const recoverStreamIfNeeded = useCallback(
    (recoverOptions: { forceRestart?: boolean } = {}) => {
      if (!shouldKeepStreamingRef.current || activeStartPromiseRef.current) return;
      if (!recoverOptions.forceRestart && isCurrentStreamHealthy()) return;
      void startStream(lastStreamOptionsRef.current);
    },
    [isCurrentStreamHealthy, startStream],
  );

  /**
   * 스트림 중지
   */
  const stopStream = useCallback((): void => {
    cleanup();
  }, [cleanup]);

  /**
   * 스트림 재시도
   */
  const retryStream = useCallback(async (): Promise<void> => {
    await startStream(options);
  }, [startStream, options]);

  /**
   * 카메라 전환
   */
  const switchCamera = useCallback(
    async (deviceId?: string): Promise<void> => {
      const { devices, currentDevice } = state;

      if (devices.length < 2) {
        console.warn("Not enough camera devices to switch");
        return;
      }

      let targetDevice: CameraDeviceInfo;

      if (deviceId) {
        targetDevice = devices.find((device) => device.deviceId === deviceId)!;
        if (!targetDevice) {
          console.error("Target device not found");
          return;
        }
      } else {
        // 현재 디바이스가 아닌 다른 디바이스 선택
        const currentIndex = devices.findIndex((device) => device.deviceId === currentDevice?.deviceId);
        const nextIndex = (currentIndex + 1) % devices.length;
        targetDevice = devices[nextIndex];
      }

      // 새로운 제약 조건으로 스트림 시작
      const newOptions: CameraStreamOptions = {
        ...options,
        video: {
          deviceId: targetDevice.deviceId,
          facingMode: targetDevice.facingMode,
        },
      };

      await startStream(newOptions);
    },
    [state, options, startStream],
  );

  /**
   * 컴포넌트 마운트 시 초기화
   */
  useEffect(() => {
    // 초기 디바이스 목록 가져오기
    getDevices();

    // cleanup 함수
    return () => {
      cleanup();
    };
  }, [getDevices, cleanup]);

  /**
   * 백그라운드 복귀 시 Android 브라우저에서 종료된 카메라 트랙 복구
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasPageHiddenRef.current = true;
        return;
      }

      const forceRestart = wasPageHiddenRef.current;
      wasPageHiddenRef.current = false;
      recoverStreamIfNeeded({ forceRestart });
    };

    const handlePageHide = () => {
      wasPageHiddenRef.current = true;
    };

    const handlePageShow = () => {
      const forceRestart = wasPageHiddenRef.current;
      wasPageHiddenRef.current = false;
      recoverStreamIfNeeded({ forceRestart });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange, false);
    window.addEventListener("pagehide", handlePageHide, false);
    window.addEventListener("pageshow", handlePageShow, false);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [recoverStreamIfNeeded]);

  /**
   * 스트림 상태 변화 감지
   */
  useEffect(() => {
    if (!streamRef.current) return;

    const stream = streamRef.current;

    const handleTrackInterrupted = () => {
      console.log("Camera track interrupted unexpectedly");
      updateState({
        isStreaming: false,
        stream: null,
      });

      if (document.visibilityState === "visible") {
        recoverStreamIfNeeded();
      } else {
        wasPageHiddenRef.current = true;
      }
    };

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", handleTrackInterrupted);
      videoTrack.addEventListener("mute", handleTrackInterrupted);

      return () => {
        videoTrack.removeEventListener("ended", handleTrackInterrupted);
        videoTrack.removeEventListener("mute", handleTrackInterrupted);
      };
    }
  }, [recoverStreamIfNeeded, state.stream, updateState]);

  return {
    // State
    ...state,

    // Actions
    startStream,
    stopStream,
    retryStream,
    switchCamera,
    getDevices,
    checkPermission,
  };
};

export default useCameraStream;
