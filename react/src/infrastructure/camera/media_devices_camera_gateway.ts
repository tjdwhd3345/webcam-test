import { CameraDeviceInfo, CameraFacingMode } from "@lib/auth/types/camera";

type NavigatorProvider = () => Navigator | undefined;

const defaultNavigatorProvider: NavigatorProvider = () => {
  if (typeof navigator === "undefined") return undefined;
  return navigator;
};

export class MediaDevicesCameraGateway {
  private readonly getNavigator: NavigatorProvider;

  constructor(getNavigator: NavigatorProvider = defaultNavigatorProvider) {
    this.getNavigator = getNavigator;
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

  public async enumerateVideoInputs(): Promise<CameraDeviceInfo[]> {
    const devices = await this.getMediaDevices().enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    const cameras: CameraDeviceInfo[] = [];

    for (const device of videoInputs) {
      cameras.push(await this.toCameraDeviceInfo(device));
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

  private async toCameraDeviceInfo(device: MediaDeviceInfo): Promise<CameraDeviceInfo> {
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

    const { capabilities, settings } = await this.getVideoDeviceCapabilities(device.deviceId);

    return {
      deviceId: settings.deviceId || capabilities?.deviceId || device.deviceId,
      label: device.label,
      facingMode: this.resolveFacingMode(device.label, capabilities?.facingMode ?? (settings.facingMode ? [settings.facingMode] : undefined)),
      capabilities,
    };
  }

  private async getVideoDeviceCapabilities(deviceId: string): Promise<{ capabilities?: MediaTrackCapabilities; settings: MediaTrackSettings }> {
    const stream = await this.openStream({ video: { deviceId: { exact: deviceId } }, audio: false });

    try {
      const track = stream.getVideoTracks()[0];

      return {
        capabilities: track?.getCapabilities?.(),
        settings: track?.getSettings?.() ?? {},
      };
    } finally {
      this.stopStream(stream);
    }
  }

  private resolveFacingMode(label: string, facingModes?: string[]): CameraFacingMode | undefined {
    if (facingModes?.includes("environment")) return "environment";
    if (facingModes?.includes("user")) return "user";
    if (/back|rear|environment|후면/i.test(label)) return "environment";
    if (/front|user|전면/i.test(label)) return "user";

    return "environment";
  }
}
