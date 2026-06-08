"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraDeviceInfo } from "@lib/auth/camera";
import { IdcardCameraError, mapBrowserErrorToIdcardCameraError } from "@/domain/camera/camera_errors";
import type { PreparedIdcardCameraStreamResult, PrepareIdcardCameraStreamInput } from "@/domain/camera/prepare_idcard_camera_stream";
import  { PrepareIdcardCameraStream } from "@/domain/camera/prepare_idcard_camera_stream";
import { MediaDevicesCameraGateway } from "@/infrastructure/camera/media_devices_camera_gateway";

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
  stopStream: () => void;
}

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

  const gatewayRef = useRef(new MediaDevicesCameraGateway());
  const usecaseRef = useRef(new PrepareIdcardCameraStream(gatewayRef.current));
  const streamRef = useRef<MediaStream | null>(null);
  const activePreparePromiseRef = useRef<Promise<PreparedIdcardCameraStreamResult> | null>(null);
  const requestIdRef = useRef(0);

  const updateState = useCallback((updates: Partial<IdcardCameraStreamState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const stopStream = useCallback(() => {
    requestIdRef.current += 1;
    activePreparePromiseRef.current = null;

    if (streamRef.current) {
      gatewayRef.current.stopStream(streamRef.current);
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

      if (streamRef.current) {
        gatewayRef.current.stopStream(streamRef.current);
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
          const result = await usecaseRef.current.execute(input);

          if (requestId !== requestIdRef.current) {
            gatewayRef.current.stopStream(result.stream);
            throw new IdcardCameraError("camera_stream_stopped");
          }

          streamRef.current = result.stream;
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

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return {
    ...state,
    prepareStream,
    stopStream,
  };
};

export default useIdcardCameraStream;
