import { CameraDeviceInfo } from "@lib/auth/types/camera";
import { IdcardCameraError, isWidthHeightOverconstrainedError, mapBrowserErrorToIdcardCameraError } from "./camera_errors.ts";
import { IdcardCameraPolicy, IdcardCameraResolutionAttempt, IdcardCameraTarget } from "./idcard_camera_policy.ts";

export interface IdcardCameraGateway {
  isSupported(): boolean;
  queryPermission(): Promise<PermissionState>;
  requestPermission(constraints?: MediaStreamConstraints): Promise<MediaStream>;
  enumerateVideoInputs(): Promise<CameraDeviceInfo[]>;
  openStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
  stopStream(stream: MediaStream | null): void;
}

export interface PrepareIdcardCameraStreamInput {
  target: IdcardCameraTarget;
}

export interface PreparedIdcardCameraStreamResult {
  stream: MediaStream;
  selectedDevice: CameraDeviceInfo | null;
  actualSettings: MediaTrackSettings;
  resolutionAttempt: IdcardCameraResolutionAttempt;
}

export class PrepareIdcardCameraStream {
  private readonly gateway: IdcardCameraGateway;
  private readonly policy: IdcardCameraPolicy;

  constructor(gateway: IdcardCameraGateway, policy = new IdcardCameraPolicy()) {
    this.gateway = gateway;
    this.policy = policy;
  }

  public async execute(_input: PrepareIdcardCameraStreamInput): Promise<PreparedIdcardCameraStreamResult> {
    if (!this.gateway.isSupported()) {
      throw new IdcardCameraError("media_devices_not_supported");
    }

    const permissionState = await this.gateway.queryPermission();

    if (permissionState === "denied") {
      throw new IdcardCameraError("camera_permission_denied");
    }

    const permissionStream = await this.gateway.requestPermission(this.policy.createPermissionConstraints()).catch((error) => {
      throw mapBrowserErrorToIdcardCameraError(error);
    });
    this.gateway.stopStream(permissionStream);

    const devices = await this.gateway.enumerateVideoInputs();
    const candidates = this.policy.selectVideoInputDevices(devices);
    const selectedDevice = this.policy.selectPreferredDevice(candidates);

    if (!selectedDevice) {
      throw new IdcardCameraError("camera_not_found");
    }

    const resolutions = this.policy.getResolutionCandidates();
    let lastError: unknown;

    for (const resolution of resolutions) {
      try {
        const constraints = this.policy.createMediaStreamConstraints(selectedDevice, resolution);
        const stream = await this.gateway.openStream(constraints);
        const validation = this.policy.validateStream(stream);

        if (!validation.valid) {
          this.gateway.stopStream(stream);
          throw new IdcardCameraError("camera_stream_invalid");
        }

        return {
          stream,
          selectedDevice: this.policy.findSelectedDevice(candidates, validation.settings) ?? selectedDevice,
          actualSettings: validation.settings,
          resolutionAttempt: resolution.attempt,
        };
      } catch (error) {
        lastError = error;

        if (resolution.attempt === "preferred" && isWidthHeightOverconstrainedError(error)) {
          continue;
        }

        throw mapBrowserErrorToIdcardCameraError(error);
      }
    }

    throw mapBrowserErrorToIdcardCameraError(lastError);
  }
}
