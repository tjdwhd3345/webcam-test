import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { IdcardCameraError, isWidthHeightOverconstrainedError, mapBrowserErrorToIdcardCameraError } from "./camera_errors";
import type { IdcardCameraDiagnosticChannel, IdcardCameraDiagnosticLogger } from "./idcard_camera_diagnostics";
import { summarizeCameraDevice, summarizeCameraError, summarizeCameraSettings, summarizeMediaStreamConstraints } from "./idcard_camera_diagnostics";
import type { IdcardCameraFacingAssessment, IdcardCameraResolutionAttempt, IdcardCameraSelectionReason, IdcardCameraTarget } from "./idcard_camera_policy";
import { IdcardCameraPolicy } from "./idcard_camera_policy";

export interface IdcardCameraGateway {
  isSupported(): boolean;
  queryPermission(): Promise<PermissionState>;
  requestPermission(constraints?: MediaStreamConstraints): Promise<MediaStream>;
  enumerateVideoInputs(options: { probeCapabilities: boolean }): Promise<CameraDeviceInfo[]>;
  openStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
  stopStream(stream: MediaStream | null): void;
}

export interface PrepareIdcardCameraStreamInput {
  target: IdcardCameraTarget;
  requireEnvironmentCamera?: boolean;
}

export interface PreparedIdcardCameraStreamResult {
  stream: MediaStream;
  selectedDevice: CameraDeviceInfo | null;
  actualSettings: MediaTrackSettings;
  resolutionAttempt: IdcardCameraResolutionAttempt;
  selectionReason: IdcardCameraSelectionReason;
  facingAssessment: IdcardCameraFacingAssessment;
}

interface IdcardCameraPreparationEventBase {
  target: IdcardCameraTarget;
  requireEnvironmentCamera: boolean;
  attemptToken?: number;
}

export type IdcardCameraPreparationEvent = IdcardCameraPreparationEventBase &
  (
    | { type: "permission_checked"; permissionState: PermissionState }
    | { type: "permission_requested"; constraints: MediaStreamConstraints }
    | { type: "permission_granted"; settings: MediaTrackSettings; facingAssessment: IdcardCameraFacingAssessment }
    | { type: "permission_denied"; source: "query" | "request"; errorName?: string }
    | {
        type: "constraint_failed";
        stage: "permission" | "final_stream";
        constraints: MediaStreamConstraints;
        errorName: "OverconstrainedError" | "ConstraintNotSatisfiedError";
        constraint?: string;
        resolutionAttempt?: IdcardCameraResolutionAttempt;
      }
    | {
        type: "front_facing_detected";
        stage: "permission" | "final_stream";
        detectionSource: "track_settings" | "enumerated_device";
        facingAssessment: "user";
        constraints: MediaStreamConstraints;
        settings: MediaTrackSettings;
        resolutionAttempt?: IdcardCameraResolutionAttempt;
      }
    | {
        type: "device_selected";
        selectionReason: IdcardCameraSelectionReason;
        constraints: MediaStreamConstraints;
        settings: MediaTrackSettings;
        resolutionAttempt: IdcardCameraResolutionAttempt;
      }
  );

export type IdcardCameraPreparationObserver = (event: IdcardCameraPreparationEvent) => void;

const getErrorName = (error: unknown): string | undefined => {
  const name = (error as { name?: unknown } | undefined)?.name;
  return typeof name === "string" ? name : undefined;
};

const getConstraintFailure = (error: unknown): { errorName: "OverconstrainedError" | "ConstraintNotSatisfiedError"; constraint?: string } | null => {
  const errorName = getErrorName(error);
  if (errorName !== "OverconstrainedError" && errorName !== "ConstraintNotSatisfiedError") return null;

  const constraintError = error as { constraint?: unknown; constraintName?: unknown } | undefined;
  const constraint = constraintError?.constraint ?? constraintError?.constraintName;

  return {
    errorName,
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
};

const isCandidateRetryableError = (error: IdcardCameraError): boolean => {
  switch (error.code) {
    case "camera_front_facing_detected":
    case "camera_environment_not_available":
    case "camera_not_found":
    case "camera_resolution_not_supported":
    case "camera_constraint_not_supported":
    case "camera_stream_invalid":
      return true;
    default:
      return false;
  }
};

export class PrepareIdcardCameraStream {
  private readonly gateway: IdcardCameraGateway;
  private readonly policy: IdcardCameraPolicy;
  private readonly observer?: IdcardCameraPreparationObserver;
  private readonly diagnosticLogger?: IdcardCameraDiagnosticLogger;

  constructor(gateway: IdcardCameraGateway, policy = new IdcardCameraPolicy(), observer?: IdcardCameraPreparationObserver, diagnosticLogger?: IdcardCameraDiagnosticLogger) {
    this.gateway = gateway;
    this.policy = policy;
    this.observer = observer;
    this.diagnosticLogger = diagnosticLogger;
  }

  public async execute(input: PrepareIdcardCameraStreamInput, attemptToken?: number): Promise<PreparedIdcardCameraStreamResult> {
    const requireEnvironmentCamera = input.requireEnvironmentCamera === true;
    const eventBase: IdcardCameraPreparationEventBase = {
      target: input.target,
      requireEnvironmentCamera,
      ...(attemptToken === undefined ? {} : { attemptToken }),
    };

    if (!this.gateway.isSupported()) {
      throw new IdcardCameraError("media_devices_not_supported");
    }

    const permissionState = await this.gateway.queryPermission();
    this.emit({ ...eventBase, type: "permission_checked", permissionState });

    if (permissionState === "denied") {
      this.emit({ ...eventBase, type: "permission_denied", source: "query" });
      throw new IdcardCameraError("camera_permission_denied");
    }

    const permissionConstraints = this.policy.createPermissionConstraints();
    this.emit({ ...eventBase, type: "permission_requested", constraints: permissionConstraints });
    this.debug("getUserMedia", {
      ...eventBase,
      stage: "permission",
      status: "requested",
      constraints: summarizeMediaStreamConstraints(permissionConstraints),
    });

    let permissionStream: MediaStream;
    try {
      permissionStream = await this.gateway.requestPermission(permissionConstraints);
    } catch (error) {
      this.debug("getUserMedia", {
        ...eventBase,
        stage: "permission",
        status: "failed",
        constraints: summarizeMediaStreamConstraints(permissionConstraints),
        error: summarizeCameraError(error),
      });
      this.emitConstraintFailure(eventBase, "permission", permissionConstraints, error);
      const cameraError = mapBrowserErrorToIdcardCameraError(error);
      if (cameraError.code === "camera_permission_denied") {
        this.emit({ ...eventBase, type: "permission_denied", source: "request", errorName: getErrorName(error) });
      }
      throw cameraError;
    }

    let permissionSettings: MediaTrackSettings = {};
    try {
      permissionSettings = permissionStream.getVideoTracks()[0]?.getSettings?.() ?? {};
    } finally {
      this.gateway.stopStream(permissionStream);
    }

    const permissionFacingAssessment = this.policy.assessStreamFacing(permissionSettings);
    this.debug("getUserMedia", {
      ...eventBase,
      stage: "permission",
      status: "succeeded",
      constraints: summarizeMediaStreamConstraints(permissionConstraints),
      settings: summarizeCameraSettings(permissionSettings),
      facingAssessment: permissionFacingAssessment,
    });
    this.emit({ ...eventBase, type: "permission_granted", settings: permissionSettings, facingAssessment: permissionFacingAssessment });

    const permissionFrontFacingDetected = requireEnvironmentCamera && permissionFacingAssessment === "user";
    if (permissionFrontFacingDetected) {
      this.emitFrontFacingDetected(eventBase, "permission", permissionSettings, permissionConstraints, "track_settings");
    }

    const devices = await this.gateway.enumerateVideoInputs({ probeCapabilities: !requireEnvironmentCamera });
    this.debug("devices", {
      ...eventBase,
      phase: "enumerated",
      probeCapabilities: !requireEnvironmentCamera,
      count: devices.length,
      devices: devices.map((device, index) => summarizeCameraDevice(device, index)),
    });
    const permissionFacingWithDevices = this.policy.assessStreamFacing(permissionSettings, devices);
    if (requireEnvironmentCamera && !permissionFrontFacingDetected && permissionFacingWithDevices === "user") {
      this.emitFrontFacingDetected(eventBase, "permission", permissionSettings, permissionConstraints, "enumerated_device");
    }

    const decisions = this.policy.evaluateVideoInputDevices(devices, requireEnvironmentCamera);
    decisions.forEach((decision, index) => {
      this.debug("selection", {
        ...eventBase,
        phase: "device_filter",
        device: summarizeCameraDevice(decision.device, index),
        facingAssessment: decision.facingAssessment,
        passed: decision.passed,
        reasons: decision.reasons,
      });
    });

    const candidates = decisions.filter(({ passed }) => passed).map(({ device }) => device);
    const orderedCandidates = this.policy.orderPreferredDevices(candidates);
    const preferredDevice = orderedCandidates[0] ?? null;
    this.debug("candidates", {
      ...eventBase,
      count: orderedCandidates.length,
      devices: orderedCandidates.map((device, index) => summarizeCameraDevice(device, index)),
      selectedDevice: preferredDevice ? summarizeCameraDevice(preferredDevice) : null,
      selectionSource: preferredDevice ? "policy_priority" : "none",
    });

    if (!preferredDevice) {
      throw new IdcardCameraError("camera_not_found");
    }

    const resolutions = this.policy.getResolutionCandidates();
    let lastError: unknown;

    candidateLoop: for (const candidate of orderedCandidates) {
      for (const resolution of resolutions) {
        const constraints = this.policy.createMediaStreamConstraints(candidate, resolution, requireEnvironmentCamera);
        this.debug("getUserMedia", {
          ...eventBase,
          stage: "final_stream",
          status: "requested",
          resolutionAttempt: resolution.attempt,
          requestedDevice: summarizeCameraDevice(candidate),
          constraints: summarizeMediaStreamConstraints(constraints),
        });
        let stream: MediaStream | null = null;
        let streamAcquired = false;

        try {
          stream = await this.gateway.openStream(constraints);
          streamAcquired = true;
          const validation = this.policy.validateStream(stream, { devices, requestedDevice: candidate, requireEnvironmentCamera });
          const facingAssessment = this.policy.assessStreamFacing(validation.settings, devices, candidate);
          const actualEnumeratedDevice = this.policy.findSelectedDevice(devices, validation.settings);
          const actualCandidateDevice = this.policy.findSelectedDevice(orderedCandidates, validation.settings);

          this.debug("getUserMedia", {
            ...eventBase,
            stage: "final_stream",
            status: "succeeded",
            resolutionAttempt: resolution.attempt,
            constraints: summarizeMediaStreamConstraints(constraints),
            settings: summarizeCameraSettings(validation.settings),
          });
          this.debug("selection", {
            ...eventBase,
            phase: "final_stream_validation",
            resolutionAttempt: resolution.attempt,
            requestedDevice: summarizeCameraDevice(candidate),
            actualDevice: actualEnumeratedDevice ? summarizeCameraDevice(actualEnumeratedDevice) : null,
            actualDeviceIsCandidate: actualCandidateDevice !== null,
            deviceIdMatched: !!validation.settings.deviceId && validation.settings.deviceId === candidate.deviceId,
            facingAssessment,
            settings: summarizeCameraSettings(validation.settings),
            passed: validation.valid,
          });

          if (!validation.valid) {
            this.gateway.stopStream(stream);
            stream = null;
            if (requireEnvironmentCamera && facingAssessment === "user") {
              const detectionSource = validation.settings.facingMode === "user" ? "track_settings" : "enumerated_device";
              this.throwFrontFacingDetected(eventBase, "final_stream", validation.settings, constraints, detectionSource, resolution.attempt);
            }
            throw new IdcardCameraError("camera_stream_invalid");
          }

          const actualDevice = this.policy.findSelectedDevice(orderedCandidates, validation.settings) ?? candidate;
          const selectionReason = this.policy.getSelectionReason(candidate, requireEnvironmentCamera);
          this.emit({
            ...eventBase,
            type: "device_selected",
            selectionReason,
            constraints,
            settings: validation.settings,
            resolutionAttempt: resolution.attempt,
          });

          return {
            stream,
            selectedDevice: actualDevice,
            actualSettings: validation.settings,
            resolutionAttempt: resolution.attempt,
            selectionReason,
            facingAssessment,
          };
        } catch (error) {
          lastError = error;
          if (stream) {
            this.gateway.stopStream(stream);
          }
          if (!streamAcquired) {
            this.debug("getUserMedia", {
              ...eventBase,
              stage: "final_stream",
              status: "failed",
              resolutionAttempt: resolution.attempt,
              constraints: summarizeMediaStreamConstraints(constraints),
              error: summarizeCameraError(error),
            });
          }
          this.emitConstraintFailure(eventBase, "final_stream", constraints, error, resolution.attempt);

          if (resolution.attempt === "preferred" && isWidthHeightOverconstrainedError(error)) {
            continue;
          }

          const cameraError = mapBrowserErrorToIdcardCameraError(error);
          if (!isCandidateRetryableError(cameraError)) {
            throw cameraError;
          }

          continue candidateLoop;
        }
      }
    }

    throw mapBrowserErrorToIdcardCameraError(lastError);
  }

  private throwFrontFacingDetected(
    eventBase: IdcardCameraPreparationEventBase,
    stage: "permission" | "final_stream",
    settings: MediaTrackSettings,
    constraints: MediaStreamConstraints,
    detectionSource: "track_settings" | "enumerated_device",
    resolutionAttempt?: IdcardCameraResolutionAttempt,
  ): never {
    this.emitFrontFacingDetected(eventBase, stage, settings, constraints, detectionSource, resolutionAttempt);
    throw new IdcardCameraError("camera_front_facing_detected");
  }

  private emitFrontFacingDetected(
    eventBase: IdcardCameraPreparationEventBase,
    stage: "permission" | "final_stream",
    settings: MediaTrackSettings,
    constraints: MediaStreamConstraints,
    detectionSource: "track_settings" | "enumerated_device",
    resolutionAttempt?: IdcardCameraResolutionAttempt,
  ): void {
    this.emit({
      ...eventBase,
      type: "front_facing_detected",
      stage,
      detectionSource,
      facingAssessment: "user",
      constraints,
      settings,
      ...(resolutionAttempt === undefined ? {} : { resolutionAttempt }),
    });
  }

  private emitConstraintFailure(
    eventBase: IdcardCameraPreparationEventBase,
    stage: "permission" | "final_stream",
    constraints: MediaStreamConstraints,
    error: unknown,
    resolutionAttempt?: IdcardCameraResolutionAttempt,
  ): void {
    const failure = getConstraintFailure(error);
    if (!failure) return;

    this.emit({
      ...eventBase,
      type: "constraint_failed",
      stage,
      constraints,
      ...failure,
      ...(resolutionAttempt === undefined ? {} : { resolutionAttempt }),
    });
  }

  private emit(event: IdcardCameraPreparationEvent): void {
    try {
      this.observer?.(event);
    } catch {
      // Observability must not interrupt camera preparation.
    }
  }

  private debug(channel: IdcardCameraDiagnosticChannel, payload: Record<string, unknown>): void {
    try {
      this.diagnosticLogger?.(channel, payload);
    } catch {
      // Diagnostics must not interrupt camera preparation.
    }
  }
}
