import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdcardCameraPolicy } from "@tobe/domain/camera/idcard_camera_policy";
import { IdcardCameraError, mapBrowserErrorToIdcardCameraError } from "@tobe/domain/camera/camera_errors";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { MediaDevicesCameraGateway } from "@tobe/infrastructure/camera/media_devices_camera_gateway";
import { useIdcardCameraStream } from "@tobe/lib/hook/useIdcardCameraStream";
import { CameraPanel } from "./CameraPanel";
import { runCameraOperation } from "./camera_operation_queue";
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
  const [automaticIntent, setAutomaticIntent] = useState(false);
  const [manualDevice, setManualDevice] = useState<CameraDeviceInfo | null>(null);
  const [manualValidation, setManualValidation] = useState<CameraValidationView | null>(null);
  const [preparationDetails, setPreparationDetails] = useState<(CameraPreparationDetailsView & { stream: MediaStream }) | null>(null);
  const manualStreamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const operationIdRef = useRef(0);

  const releaseManualStream = useCallback(() => {
    gateway.stopStream(manualStreamRef.current);
    manualStreamRef.current = null;
    setManualStream(null);
    setManualDevice(null);
    setManualValidation(null);
  }, [gateway]);

  const stopAllStreams = useCallback(() => {
    operationIdRef.current += 1;
    setAutomaticIntent(false);
    stopStream();
    releaseManualStream();
    setPreparationDetails(null);
  }, [releaseManualStream, stopStream]);

  const requestPermission = useCallback(async () => {
    stopAllStreams();
    const operationId = operationIdRef.current;
    return runCameraOperation(async () => {
      if (!mountedRef.current || operationId !== operationIdRef.current) return "unknown" as const;
      let bootstrap: MediaStream | null = null;
      try {
        bootstrap = await gateway.requestPermission({ video: true, audio: false });
      } catch (error) {
        throw mapBrowserErrorToIdcardCameraError(error);
      } finally {
        gateway.stopStream(bootstrap);
      }
      return gateway.queryPermission();
    });
  }, [gateway, stopAllStreams]);

  const enumerateDevices = useCallback(async () => {
    stopAllStreams();
    const operationId = operationIdRef.current;
    return runCameraOperation(async () => {
      if (!mountedRef.current || operationId !== operationIdRef.current) return [];
      try {
        const permission = await gateway.queryPermission();
        if (!mountedRef.current || operationId !== operationIdRef.current) return [];
        if (permission === "denied") throw new IdcardCameraError("camera_permission_denied");

        if (permission === "prompt") {
          let bootstrap: MediaStream | null = null;
          try {
            bootstrap = await gateway.requestPermission({ video: true, audio: false });
          } finally {
            gateway.stopStream(bootstrap);
          }
          if (!mountedRef.current || operationId !== operationIdRef.current) return [];
        }

        const nextDevices = await gateway.enumerateVideoInputs({ probeCapabilities: !requireEnvironmentCamera });
        if (!mountedRef.current || operationId !== operationIdRef.current) return [];
        setDevices(nextDevices);
        return nextDevices.map(toRawMediaDevice);
      } catch (error) {
        if (!mountedRef.current || operationId !== operationIdRef.current) return [];
        throw mapBrowserErrorToIdcardCameraError(error);
      }
    });
  }, [gateway, requireEnvironmentCamera, stopAllStreams]);

  const startAutomatic = useCallback(async () => {
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    releaseManualStream();
    stopStream();
    setAutomaticIntent(true);
    setPreparationDetails(null);

    return runCameraOperation(async () => {
      if (!mountedRef.current || operationId !== operationIdRef.current) return;
      let result: Awaited<ReturnType<typeof prepareStream>>;
      try {
        result = await prepareStream({
          target: "idcard_front",
          requireEnvironmentCamera,
        });
      } catch (error) {
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        throw error;
      }

      if (!mountedRef.current || operationId !== operationIdRef.current) return;
      setPreparationDetails({
        stream: result.stream,
        selectionReason: result.selectionReason,
        facingAssessment: result.facingAssessment,
        resolutionAttempt: result.resolutionAttempt,
        validation: policy.validateStream(result.stream, {
          devices,
          requestedDevice: result.selectedDevice,
          requireEnvironmentCamera,
        }),
      });
    });
  }, [devices, policy, prepareStream, releaseManualStream, requireEnvironmentCamera, stopStream]);

  const startManualDevice = useCallback(
    async (rawDevice: RawMediaDevice) => {
      const operationId = operationIdRef.current + 1;
      operationIdRef.current = operationId;
      stopStream();
      setAutomaticIntent(false);
      releaseManualStream();
      setPreparationDetails(null);

      return runCameraOperation(async () => {
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        let stream: MediaStream | null = null;
        try {
          const nextDevices = await gateway.enumerateVideoInputs({ probeCapabilities: false });
          if (!mountedRef.current || operationId !== operationIdRef.current) return;
          setDevices(nextDevices);

          const requestedDevice = rawDevice.deviceId
            ? nextDevices.find((device) => device.deviceId === rawDevice.deviceId)
            : undefined;
          if (!requestedDevice) {
            throw new IdcardCameraError(
              "camera_not_found",
              "선택한 카메라를 찾을 수 없습니다. 카메라 목록을 다시 조회해 주세요.",
            );
          }

          stream = await gateway.openStream(toExactDeviceConstraints(toRawMediaDevice(requestedDevice)));

          if (!mountedRef.current || operationId !== operationIdRef.current) {
            gateway.stopStream(stream);
            return;
          }

          const validation = policy.validateStream(stream, {
            devices: nextDevices,
            requestedDevice,
            requireEnvironmentCamera,
          });
          manualStreamRef.current = stream;
          setManualStream(stream);
          setManualDevice(requestedDevice);
          setManualValidation(validation);
        } catch (error) {
          gateway.stopStream(stream);
          if (!mountedRef.current || operationId !== operationIdRef.current) return;
          throw mapBrowserErrorToIdcardCameraError(error);
        }
      });
    },
    [gateway, policy, releaseManualStream, requireEnvironmentCamera, stopStream],
  );

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
      operationIdRef.current += 1;
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
      isLoading={automaticIntent && camera.isLoading}
      hookError={automaticIntent ? camera.error : null}
      requireEnvironmentCamera={requireEnvironmentCamera}
      policyDecisions={policyDecisions}
      preparationDetails={preparationDetails?.stream === camera.stream && !camera.error ? preparationDetails : null}
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
