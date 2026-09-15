import type { CameraDeviceInfo, CameraFacingMode } from "@tobe/lib/auth/types/camera";
import type { IdcardCameraDiagnosticChannel, IdcardCameraDiagnosticLogger } from "@tobe/domain/camera/idcard_camera_diagnostics";
import {
  maskCameraDeviceId,
  summarizeCameraCapabilities,
  summarizeCameraDevice,
  summarizeCameraError,
  summarizeCameraSettings,
  summarizeMediaStreamConstraints,
} from "@tobe/domain/camera/idcard_camera_diagnostics";
import type { IdcardCameraGateway } from "@tobe/domain/camera/prepare_idcard_camera_stream";

type NavigatorProvider = () => Navigator | undefined;

const defaultNavigatorProvider: NavigatorProvider = () => {
  if (typeof navigator === "undefined") return undefined;
  return navigator;
};

export class MediaDevicesCameraGateway {
  private readonly getNavigator: NavigatorProvider;
  private readonly diagnosticLogger?: IdcardCameraDiagnosticLogger;

  constructor(getNavigator: NavigatorProvider = defaultNavigatorProvider, diagnosticLogger?: IdcardCameraDiagnosticLogger) {
    this.getNavigator = getNavigator;
    this.diagnosticLogger = diagnosticLogger;
  }

  public isSupported(): boolean {
    const mediaDevices = this.getNavigator()?.mediaDevices;

    return typeof mediaDevices?.getUserMedia === "function" && typeof mediaDevices.enumerateDevices === "function";
  }

  public async queryPermission(): Promise<PermissionState> {
    const permissions = this.getNavigator()?.permissions;

    if (!permissions?.query) return "prompt";

    try {
      const status = await permissions.query({ name: "camera" as PermissionName });
      return status.state;
    } catch {
      return "prompt";
    }
  }

  public async requestPermission(constraints: MediaStreamConstraints = { video: true, audio: false }): Promise<MediaStream> {
    return this.getMediaDevices().getUserMedia(constraints);
  }

  public async enumerateVideoInputs({ probeCapabilities }: Parameters<IdcardCameraGateway["enumerateVideoInputs"]>[0]): Promise<CameraDeviceInfo[]> {
    const devices = await this.getMediaDevices().enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    const cameras: CameraDeviceInfo[] = [];

    this.debug("devices", {
      phase: "enumerated_raw",
      probeCapabilities,
      count: videoInputs.length,
      devices: videoInputs.map((device, index) =>
        summarizeCameraDevice(
          {
            deviceId: device.deviceId,
            label: device.label,
            facingMode: this.resolveFacingMode(device.label),
          },
          index,
        ),
      ),
    });

    for (const device of videoInputs) {
      cameras.push(await this.toCameraDeviceInfo(device, probeCapabilities));
    }

    return cameras;
  }

  public async openStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    return this.getMediaDevices().getUserMedia(constraints);
  }

  public stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private getMediaDevices(): MediaDevices {
    const mediaDevices = this.getNavigator()?.mediaDevices;

    if (!mediaDevices) {
      throw new Error("MediaDevices API is not supported.");
    }

    return mediaDevices;
  }

  private async toCameraDeviceInfo(device: MediaDeviceInfo, probeCapabilities: boolean): Promise<CameraDeviceInfo> {
    const inputDevice = device as InputDeviceInfo;
    if (typeof inputDevice.getCapabilities === "function") {
      const capabilities = inputDevice.getCapabilities();

      return {
        deviceId: capabilities.deviceId || device.deviceId,
        label: device.label,
        facingMode: this.resolveFacingMode(device.label, capabilities.facingMode),
        capabilities,
      };
    }

    if (!probeCapabilities) {
      return {
        deviceId: device.deviceId,
        label: device.label,
        facingMode: this.resolveFacingMode(device.label),
      };
    }

    const { capabilities, settings } = await this.getVideoDeviceCapabilities(device.deviceId);

    return {
      deviceId: settings.deviceId || capabilities?.deviceId || device.deviceId,
      label: device.label,
      facingMode: this.resolveFacingMode(device.label, capabilities?.facingMode ?? (settings.facingMode ? [settings.facingMode] : undefined)),
      capabilities,
    };
  }

  private async getVideoDeviceCapabilities(deviceId: string): Promise<{ capabilities?: MediaTrackCapabilities; settings: MediaTrackSettings }> {
    const constraints: MediaStreamConstraints = { video: { deviceId: { exact: deviceId } }, audio: false };
    this.debug("getUserMedia", {
      stage: "device_probe",
      status: "requested",
      deviceId: maskCameraDeviceId(deviceId),
      constraints: summarizeMediaStreamConstraints(constraints),
    });

    let stream: MediaStream | null = null;

    try {
      stream = await this.openStream(constraints);
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.();
      const settings = track?.getSettings?.() ?? {};

      this.debug("getUserMedia", {
        stage: "device_probe",
        status: "succeeded",
        deviceId: maskCameraDeviceId(deviceId),
        settings: summarizeCameraSettings(settings),
        capabilities: summarizeCameraCapabilities(capabilities),
      });

      return {
        capabilities,
        settings,
      };
    } catch (error) {
      this.debug("getUserMedia", {
        stage: "device_probe",
        status: "failed",
        deviceId: maskCameraDeviceId(deviceId),
        constraints: summarizeMediaStreamConstraints(constraints),
        error: summarizeCameraError(error),
      });
      throw error;
    } finally {
      this.stopStream(stream);
    }
  }

  private debug(channel: IdcardCameraDiagnosticChannel, payload: Record<string, unknown>): void {
    try {
      this.diagnosticLogger?.(channel, payload);
    } catch {
      // Diagnostics must not interrupt camera enumeration.
    }
  }

  private resolveFacingMode(label: string, facingModes?: string[]): CameraFacingMode | undefined {
    if (facingModes?.includes("environment")) return "environment";
    if (facingModes?.includes("user")) return "user";
    if (/back|rear|environment|후면/i.test(label)) return "environment";
    if (/front|user|전면/i.test(label)) return "user";

    return undefined;
  }
}
