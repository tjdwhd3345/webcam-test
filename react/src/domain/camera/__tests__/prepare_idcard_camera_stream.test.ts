import { CameraDeviceInfo } from "@lib/auth/types/camera";
import { IdcardCameraGateway, PrepareIdcardCameraStream } from "../prepare_idcard_camera_stream";

type MockGateway = jest.Mocked<IdcardCameraGateway>;

const createStream = (settings: MediaTrackSettings) => {
  const track = {
    readyState: "live",
    getSettings: jest.fn(() => settings),
  } as unknown as MediaStreamTrack;

  return {
    getTracks: jest.fn(() => [track]),
    getVideoTracks: jest.fn(() => [track]),
  } as unknown as MediaStream;
};

const createOverconstrainedError = (constraint: "width" | "height" | "deviceId" = "width") => {
  const error = new Error(`Overconstrained ${constraint}`) as Error & { constraint: string };
  error.name = "OverconstrainedError";
  error.constraint = constraint;
  return error;
};

const createGateway = (overrides: Partial<MockGateway> = {}): MockGateway => {
  const permissionStream = createStream({ deviceId: "permission", width: 640, height: 480 });
  const devices: CameraDeviceInfo[] = [{ deviceId: "main", label: "Back Camera", facingMode: "environment" }];

  return {
    isSupported: jest.fn(() => true),
    queryPermission: jest.fn(() => Promise.resolve("prompt")),
    requestPermission: jest.fn<Promise<MediaStream>, [MediaStreamConstraints?]>(() => Promise.resolve(permissionStream)),
    enumerateVideoInputs: jest.fn(() => Promise.resolve(devices)),
    openStream: jest.fn<Promise<MediaStream>, [MediaStreamConstraints]>(() => Promise.resolve(createStream({ deviceId: "main", width: 1920, height: 1080 }))),
    stopStream: jest.fn(),
    ...overrides,
  };
};

describe("PrepareIdcardCameraStream", () => {
  it("MediaDevices 미지원이면 실패한다", async () => {
    const gateway = createGateway({ isSupported: jest.fn(() => false) });
    const usecase = new PrepareIdcardCameraStream(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({
      code: "media_devices_not_supported",
    });
    expect(gateway.queryPermission).not.toHaveBeenCalled();
  });

  it("권한 denied이면 권한 요청 없이 실패한다", async () => {
    const gateway = createGateway({ queryPermission: jest.fn(() => Promise.resolve("denied")) });
    const usecase = new PrepareIdcardCameraStream(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({
      code: "camera_permission_denied",
    });
    expect(gateway.requestPermission).not.toHaveBeenCalled();
  });

  it("1920x1080 스트림 준비에 성공한다", async () => {
    const stream = createStream({ deviceId: "main", width: 1920, height: 1080 });
    const gateway = createGateway({ openStream: jest.fn<Promise<MediaStream>, [MediaStreamConstraints]>(() => Promise.resolve(stream)) });
    const usecase = new PrepareIdcardCameraStream(gateway);

    const result = await usecase.execute({ target: "idcard_front" });

    expect(result).toEqual({
      stream,
      selectedDevice: { deviceId: "main", label: "Back Camera", facingMode: "environment" },
      actualSettings: { deviceId: "main", width: 1920, height: 1080 },
      resolutionAttempt: "preferred",
    });
    expect(gateway.openStream).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 1920, min: 1920 },
          height: { ideal: 1080, min: 1080 },
        }),
      }),
    );
  });

  it("1920x1080 width/height OverconstrainedError 후 1280x720으로 성공한다", async () => {
    const fallbackStream = createStream({ deviceId: "main", width: 1280, height: 720 });
    const gateway = createGateway({
      openStream: jest.fn().mockRejectedValueOnce(createOverconstrainedError("width")).mockResolvedValueOnce(fallbackStream),
    });
    const usecase = new PrepareIdcardCameraStream(gateway);

    const result = await usecase.execute({ target: "idcard_back" });

    expect(result.resolutionAttempt).toBe("fallback");
    expect(gateway.openStream).toHaveBeenCalledTimes(2);
    expect(gateway.openStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 1280, min: 1280 },
          height: { ideal: 720, min: 720 },
        }),
      }),
    );
  });

  it("권한/해상도 외 에러는 fallback 없이 실패한다", async () => {
    const notReadableError = new Error("Camera busy");
    notReadableError.name = "NotReadableError";
    const gateway = createGateway({ openStream: jest.fn().mockRejectedValueOnce(notReadableError) });
    const usecase = new PrepareIdcardCameraStream(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({
      code: "camera_not_readable",
    });
    expect(gateway.openStream).toHaveBeenCalledTimes(1);
  });

  it("실행된 스트림이 촬영 조건을 만족하지 못하면 실패한다", async () => {
    const invalidStream = createStream({ deviceId: "main", width: 1024, height: 576 });
    const gateway = createGateway({ openStream: jest.fn().mockResolvedValueOnce(invalidStream) });
    const usecase = new PrepareIdcardCameraStream(gateway);

    await expect(usecase.execute({ target: "idcard_front" })).rejects.toMatchObject({
      code: "camera_stream_invalid",
    });
  });
});
