"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { IdcardCameraError, mapBrowserErrorToIdcardCameraError } from "@tobe/domain/camera/camera_errors";
import type { PreparedIdcardCameraStreamResult, PrepareIdcardCameraStreamInput } from "@tobe/domain/camera/prepare_idcard_camera_stream";
import { PrepareIdcardCameraStream } from "@tobe/domain/camera/prepare_idcard_camera_stream";
import { idcardCameraConsoleLogger } from "@tobe/infrastructure/camera/idcard_camera_console_logger";
import { MediaDevicesCameraGateway } from "@tobe/infrastructure/camera/media_devices_camera_gateway";

interface IdcardCameraStreamState {
  stream: MediaStream | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: IdcardCameraError | null;
  selectedDevice: CameraDeviceInfo | null;
  actualSettings: MediaTrackSettings | null;
  resolutionAttempt: PreparedIdcardCameraStreamResult["resolutionAttempt"] | null;
}

interface UseIdcardCameraStreamReturn extends IdcardCameraStreamState {
  prepareStream: (input: PrepareIdcardCameraStreamInput) => Promise<PreparedIdcardCameraStreamResult>;
  recordVideoPlayFailure: (error: unknown, failedStream?: MediaStream) => boolean;
  stopStream: () => void;
}

type PreparedStreamAttempt = {
  input: PrepareIdcardCameraStreamInput;
};

export const useIdcardCameraStream = (): UseIdcardCameraStreamReturn => {
  const [state, setState] = useState<IdcardCameraStreamState>({
    stream: null,
    isLoading: false,
    isStreaming: false,
    error: null,
    selectedDevice: null,
    actualSettings: null,
    resolutionAttempt: null,
  });

  const gatewayRef = useRef<MediaDevicesCameraGateway | null>(null);
  if (!gatewayRef.current) gatewayRef.current = new MediaDevicesCameraGateway(undefined, idcardCameraConsoleLogger);

  const usecaseRef = useRef<PrepareIdcardCameraStream | null>(null);
  if (!usecaseRef.current) {
    usecaseRef.current = new PrepareIdcardCameraStream(
      gatewayRef.current,
      undefined,
      undefined,
      idcardCameraConsoleLogger,
    );
  }

  const streamRef = useRef<MediaStream | null>(null);
  const streamAttemptsRef = useRef<WeakMap<MediaStream, PreparedStreamAttempt> | null>(null);
  if (!streamAttemptsRef.current) streamAttemptsRef.current = new WeakMap();

  const activePreparePromiseRef = useRef<Promise<PreparedIdcardCameraStreamResult> | null>(null);
  const requestIdRef = useRef(0);
  const shouldKeepStreamingRef = useRef(false);
  const lastPrepareInputRef = useRef<PrepareIdcardCameraStreamInput | null>(null);
  const wasPageHiddenRef = useRef(false);

  const updateState = useCallback((updates: Partial<IdcardCameraStreamState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const isCurrentStreamHealthy = useCallback(() => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];

    return videoTrack?.readyState === "live" && !videoTrack.muted;
  }, []);

  const stopStream = useCallback(() => {
    shouldKeepStreamingRef.current = false;
    lastPrepareInputRef.current = null;
    wasPageHiddenRef.current = false;
    requestIdRef.current += 1;
    activePreparePromiseRef.current = null;

    if (streamRef.current) {
      gatewayRef.current?.stopStream(streamRef.current);
      streamRef.current = null;
    }

    updateState({
      stream: null,
      isLoading: false,
      isStreaming: false,
      selectedDevice: null,
      actualSettings: null,
      resolutionAttempt: null,
    });
  }, [updateState]);

  const prepareStream = useCallback(
    async (input: PrepareIdcardCameraStreamInput): Promise<PreparedIdcardCameraStreamResult> => {
      if (activePreparePromiseRef.current) {
        return activePreparePromiseRef.current;
      }

      shouldKeepStreamingRef.current = true;
      lastPrepareInputRef.current = input;

      if (streamRef.current) {
        gatewayRef.current?.stopStream(streamRef.current);
        streamRef.current = null;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      updateState({
        stream: null,
        isLoading: true,
        isStreaming: false,
        error: null,
        selectedDevice: null,
        actualSettings: null,
        resolutionAttempt: null,
      });

      const preparePromise = (async () => {
        try {
          const result = await usecaseRef.current!.execute(input);

          if (requestId !== requestIdRef.current) {
            gatewayRef.current?.stopStream(result.stream);
            throw new IdcardCameraError("camera_stream_stopped");
          }

          streamRef.current = result.stream;
          streamAttemptsRef.current?.set(result.stream, { input });
          updateState({
            stream: result.stream,
            isLoading: false,
            isStreaming: true,
            error: null,
            selectedDevice: result.selectedDevice,
            actualSettings: result.actualSettings,
            resolutionAttempt: result.resolutionAttempt,
          });

          return result;
        } catch (error) {
          const cameraError = mapBrowserErrorToIdcardCameraError(error);

          if (requestId === requestIdRef.current) {
            updateState({
              stream: null,
              isLoading: false,
              isStreaming: false,
              error: cameraError,
            });
          }

          throw cameraError;
        }
      })();

      activePreparePromiseRef.current = preparePromise;

      try {
        return await preparePromise;
      } finally {
        if (activePreparePromiseRef.current === preparePromise) {
          activePreparePromiseRef.current = null;
        }
      }
    },
    [updateState],
  );

  const recordVideoPlayFailure = useCallback((_error: unknown, failedStream?: MediaStream) => {
    const currentStream = streamRef.current;
    const lastPrepareInput = lastPrepareInputRef.current;
    if (!currentStream || !lastPrepareInput) return false;

    const reportedStream = failedStream ?? currentStream;
    if (reportedStream !== currentStream) return false;

    const attempt = streamAttemptsRef.current?.get(reportedStream);
    if (!attempt || attempt.input !== lastPrepareInput) return false;

    return true;
  }, []);

  const recoverStreamIfNeeded = useCallback(
    (recoverOptions: { forceRestart?: boolean } = {}) => {
      if (!shouldKeepStreamingRef.current || activePreparePromiseRef.current || !lastPrepareInputRef.current) return;
      if (!recoverOptions.forceRestart && isCurrentStreamHealthy()) return;

      void prepareStream(lastPrepareInputRef.current).catch(() => {
        // prepareStream updates hook error state for UI handling.
      });
    },
    [isCurrentStreamHealthy, prepareStream],
  );

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

  useEffect(() => {
    if (!state.stream) return;

    const handleTrackInterrupted = () => {
      updateState({
        stream: null,
        isStreaming: false,
      });

      if (document.visibilityState === "visible") {
        recoverStreamIfNeeded();
      } else {
        wasPageHiddenRef.current = true;
      }
    };

    const videoTrack = state.stream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.addEventListener("ended", handleTrackInterrupted);
    videoTrack.addEventListener("mute", handleTrackInterrupted);

    return () => {
      videoTrack.removeEventListener("ended", handleTrackInterrupted);
      videoTrack.removeEventListener("mute", handleTrackInterrupted);
    };
  }, [recoverStreamIfNeeded, state.stream, updateState]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return {
    ...state,
    prepareStream,
    recordVideoPlayFailure,
    stopStream,
  };
};
