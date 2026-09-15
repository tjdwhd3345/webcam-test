import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdcardCameraPolicy } from "@tobe/domain/camera/idcard_camera_policy";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { MediaDevicesCameraGateway } from "@tobe/infrastructure/camera/media_devices_camera_gateway";
import { useIdcardCameraStream } from "@tobe/lib/hook/useIdcardCameraStream";
import { CameraPanel } from "./CameraPanel";
import type { CameraPreparationDetailsView, CameraValidationView, RawMediaDevice } from "./camera_test_types";
import { toErrorMessage, toExactDeviceConstraints } from "./camera_test_utils";

const MOBILE_USER_AGENT_PATTERN = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;

const toRawMediaDevice = (device: CameraDeviceInfo): RawMediaDevice => ({
  deviceId: device.deviceId,
  groupId: "",
  kind: "videoinput",
  label: device.label,
  facingMode: device.facingMode,
  capabilities: device.capabilities,
});

export function ToBeCameraPanel() {
  const camera = useIdcardCameraStream();
  const { prepareStream, recordVideoPlayFailure, stopStream } = camera;
  const [gateway] = useState(() => new MediaDevicesCameraGateway());
  const [policy] = useState(() => new IdcardCameraPolicy());
  const [requireEnvironmentCamera, setRequireEnvironmentCamera] = useState(() => MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent));
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
  const [manualStream, setManualStream] = useState<MediaStream | null>(null);
  const [manualDevice, setManualDevice] = useState<CameraDeviceInfo | null>(null);
  const [manualValidation, setManualValidation] = useState<CameraValidationView | null>(null);
  const [preparationDetails, setPreparationDetails] = useState<CameraPreparationDetailsView | null>(null);
  const manualStreamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const releaseManualStream = useCallback(() => {
    gateway.stopStream(manualStreamRef.current);
    manualStreamRef.current = null;
    setManualStream(null);
    setManualDevice(null);
    setManualValidation(null);
  }, [gateway]);

  const requestPermission = useCallback(() => gateway.queryPermission(), [gateway]);

  const enumerateDevices = useCallback(async () => {
    const nextDevices = await gateway.enumerateVideoInputs({ probeCapabilities: !requireEnvironmentCamera });
    if (mountedRef.current) setDevices(nextDevices);
    return nextDevices.map(toRawMediaDevice);
  }, [gateway, requireEnvironmentCamera]);

  const startAutomatic = useCallback(async () => {
    releaseManualStream();
    setPreparationDetails(null);

    const result = await prepareStream({
      target: "idcard_front",
      requireEnvironmentCamera,
    });

    if (!mountedRef.current) return;
    setPreparationDetails({
      selectionReason: result.selectionReason,
      facingAssessment: result.facingAssessment,
      resolutionAttempt: result.resolutionAttempt,
      validation: policy.validateStream(result.stream, {
        devices,
        requestedDevice: result.selectedDevice,
        requireEnvironmentCamera,
      }),
    });
  }, [devices, policy, prepareStream, releaseManualStream, requireEnvironmentCamera]);

  const startManualDevice = useCallback(
    async (rawDevice: RawMediaDevice) => {
      stopStream();
      releaseManualStream();
      setPreparationDetails(null);

      const requestedDevice: CameraDeviceInfo = {
        deviceId: rawDevice.deviceId,
        label: rawDevice.label,
        facingMode: rawDevice.facingMode,
        capabilities: rawDevice.capabilities,
      };
      const stream = await gateway.openStream(toExactDeviceConstraints(rawDevice));

      if (!mountedRef.current) {
        gateway.stopStream(stream);
        return;
      }

      const validation = policy.validateStream(stream, {
        devices,
        requestedDevice,
        requireEnvironmentCamera,
      });
      manualStreamRef.current = stream;
      setManualStream(stream);
      setManualDevice(requestedDevice);
      setManualValidation(validation);
    },
    [devices, gateway, policy, releaseManualStream, requireEnvironmentCamera, stopStream],
  );

  const stopAllStreams = useCallback(() => {
    stopStream();
    releaseManualStream();
    setPreparationDetails(null);
  }, [releaseManualStream, stopStream]);

  const handleVideoPlayFailure = useCallback(
    (error: unknown, failedStream: MediaStream) => {
      if (manualStreamRef.current === failedStream) {
        return `직접 재생 video.play 실패: ${toErrorMessage(error)}`;
      }

      return recordVideoPlayFailure(error, failedStream) ? `자동 스트림 video.play 실패: ${toErrorMessage(error)}` : null;
    },
    [recordVideoPlayFailure],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopStream();
      gateway.stopStream(manualStreamRef.current);
      manualStreamRef.current = null;
    };
  }, [gateway, stopStream]);

  const policyDecisions = useMemo(
    () =>
      policy.evaluateVideoInputDevices(devices, requireEnvironmentCamera).map((decision) => ({
        ...decision,
        device: toRawMediaDevice(decision.device),
      })),
    [devices, policy, requireEnvironmentCamera],
  );
  const stream = manualStream ?? camera.stream;
  const selectedDevice = manualDevice ?? camera.selectedDevice;

  return (
    <CameraPanel
      mode="to-be"
      title="TO-BE"
      description="production 정책과 gateway, useIdcardCameraStream을 그대로 연결해 장치 선별과 검증 결과를 확인합니다."
      stream={stream}
      selectedDevice={selectedDevice}
      resolutionAttempt={manualStream ? null : camera.resolutionAttempt}
      isStreaming={Boolean(stream)}
      requireEnvironmentCamera={requireEnvironmentCamera}
      policyDecisions={policyDecisions}
      preparationDetails={preparationDetails}
      manualValidation={manualValidation}
      manualActionLabel="선택 장치 직접 재생 (진단)"
      automaticRequestInfo={{
        mode: "to-be",
        action: "prepare-idcard-camera",
        target: "idcard_front",
        requireEnvironmentCamera,
      }}
      getManualRequestInfo={(device) => ({
        mode: "to-be",
        action: "selected-device-diagnostic",
        constraints: toExactDeviceConstraints(device),
      })}
      onRequestPermission={requestPermission}
      onEnumerateDevices={enumerateDevices}
      onStartAutomatic={startAutomatic}
      onStartManualDevice={startManualDevice}
      onStop={stopAllStreams}
      onRequireEnvironmentCameraChange={setRequireEnvironmentCamera}
      onVideoPlayFailure={handleVideoPlayFailure}
    />
  );
}
