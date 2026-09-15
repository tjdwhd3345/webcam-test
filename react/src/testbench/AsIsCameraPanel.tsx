import { useCallback } from "react";
import { useCameraStream } from "@asis/hook/useCameraStream";
import type { CameraStreamOptions } from "@asis/types/camera";
import { CameraPanel } from "./CameraPanel";
import type { RawMediaDevice } from "./camera_test_types";
import { loadAllMediaDevices, requestCameraPermission } from "./camera_test_utils";

const IDCARD_CAMERA_OPTIONS: CameraStreamOptions = {
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
};

const toAsIsDeviceOptions = (device: RawMediaDevice): CameraStreamOptions => ({
  video: {
    deviceId: device.deviceId,
    ...(device.facingMode ? { facingMode: device.facingMode } : {}),
  },
  audio: false,
  retryCount: 1,
});

export function AsIsCameraPanel() {
  const camera = useCameraStream();
  const { startStream, stopStream } = camera;

  const startAutomatic = useCallback(async () => {
    await startStream(IDCARD_CAMERA_OPTIONS);
  }, [startStream]);

  const startManualDevice = useCallback(
    async (device: RawMediaDevice) => {
      await startStream(toAsIsDeviceOptions(device));
    },
    [startStream],
  );

  return (
    <CameraPanel
      mode="as-is"
      title="AS-IS"
      description="기존 useCameraStream 흐름으로 후면 카메라 선별, 해상도 fallback, 임의 장치 재생을 확인합니다."
      stream={camera.stream}
      selectedDevice={camera.currentDevice}
      isStreaming={camera.isStreaming}
      automaticRequestInfo={{ mode: "as-is", action: "rear-camera", options: IDCARD_CAMERA_OPTIONS }}
      getManualRequestInfo={(device) => ({
        mode: "as-is",
        action: "selected-device",
        selectedDevice: { deviceId: device.deviceId, label: device.label },
        options: toAsIsDeviceOptions(device),
      })}
      onRequestPermission={requestCameraPermission}
      onEnumerateDevices={loadAllMediaDevices}
      onStartAutomatic={startAutomatic}
      onStartManualDevice={startManualDevice}
      onStop={stopStream}
    />
  );
}
