import { afterEach, describe, expect, it, vi } from "vitest";
import { idcardCameraConsoleLogger } from "../idcard_camera_console_logger";

describe("idcardCameraConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("테스트 환경에서는 console 출력을 남기지 않는다", () => {
    const consoleLog = vi.spyOn(globalThis.console, "log").mockImplementation(() => undefined);

    idcardCameraConsoleLogger("devices", { count: 1 });

    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("브라우저 실행 환경에서는 채널 prefix와 구조화 payload를 console.log로 출력한다", () => {
    vi.stubEnv("NODE_ENV", "development");
    const consoleLog = vi.spyOn(globalThis.console, "log").mockImplementation(() => undefined);
    const payload = { count: 1 };

    idcardCameraConsoleLogger("devices", payload);

    expect(consoleLog).toHaveBeenCalledWith("[IdcardCamera][devices]", payload);
  });
});
