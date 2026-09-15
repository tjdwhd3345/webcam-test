import { describe, expect, it } from "vitest";

describe("AS-IS 카메라 모듈 경계", () => {
  it("권한 거부 오류를 namespaced utility에서 기존 오류로 변환한다", async () => {
    const { mapBrowserErrorToCameraError } = await import("../lib/camera_utils");
    const error = new Error("denied");
    error.name = "NotAllowedError";

    expect(mapBrowserErrorToCameraError(error)).toMatchObject({
      type: "NotAllowedError",
      message: "카메라 사용 권한이 거부되었습니다.",
      originalError: error,
    });
  });
});
