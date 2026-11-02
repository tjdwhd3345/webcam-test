import { describe, expect, it } from "vitest";
import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";
import { IdcardCameraPolicy } from "../idcard_camera_policy";

const localizedLabels = [
  {
    language: "한국어",
    excluded: ["전면 울트라 와이드 카메라", "후면 듀얼 와이드 카메라", "후면 울트라 와이드 카메라", "후면 망원 카메라"],
    triple: "후면 트리플 카메라",
    regular: ["후면 듀얼 카메라", "후면 카메라", "전면 카메라"],
  },
  {
    language: "영어",
    excluded: ["Front Ultra Wide Camera", "Back Dual Wide Camera", "Back Ultra Wide Camera", "Back Telephoto Camera"],
    triple: "Back Triple Camera",
    regular: ["Back Dual Camera", "Back Camera", "Front Camera"],
  },
  {
    language: "일본어",
    excluded: ["前面超広角カメラ", "背面デュアル広角カメラ", "背面超広角カメラ", "背面望遠カメラ"],
    triple: "背面トリプルカメラ",
    regular: ["背面デュアルカメラ", "背面カメラ", "前面カメラ"],
  },
  {
    language: "중국어 간체",
    excluded: ["前置超广角相机", "后置双广角镜头", "后置超广角相机", "后置长焦相机"],
    triple: "后置三镜头",
    regular: ["后置双镜头", "后置相机", "前置相机"],
  },
  {
    language: "중국어 번체",
    excluded: ["前置超廣角相機", "後置雙廣角相機", "後置超廣角相機", "後置望遠相機"],
    triple: "後置三鏡頭相機",
    regular: ["後置雙鏡頭相機", "後置相機", "前置相機"],
  },
  {
    language: "베트남어",
    excluded: ["Camera cực rộng mặt trước", "Camera kép rộng mặt sau", "Camera cực rộng mặt sau", "Camera chụp xa mặt sau"],
    triple: "Ba camera mặt sau",
    regular: ["Camera kép mặt sau", "Camera sau", "Camera trước"],
  },
  {
    language: "프랑스어",
    excluded: ["Caméra ultra grand angle avant", "Double caméra grand angle arrière", "Caméra ultra grand angle arrière", "Caméra arrière de longue focale"],
    triple: "Triple caméra arrière",
    regular: ["Double caméra arrière", "Caméra arrière", "Caméra avant"],
  },
  {
    language: "태국어",
    excluded: ["กล้องด้านหน้าอัลตร้าไวด์", "กล้องคู่ด้านหลังมุมกว้าง", "กล้องด้านหลังอัลตร้าไวด์", "กล้องด้านหลังแบบภาพระยะไกล"],
    triple: "กล้องด้านหลังสามกล้อง",
    regular: ["กล้องคู่ด้านหลัง", "กล้องด้านหลัง", "กล้องด้านหน้า"],
  },
  {
    language: "러시아어",
    excluded: ["Передняя сверхширокоугольная камера", "Задняя двойная широкоугольная камера", "Задняя сверхширокоугольная камера", "Камера с задним телеобъективом"],
    triple: "Задняя тройная камера",
    regular: ["Задняя двойная камера", "Камера на задней панели", "Камера на передней панели"],
  },
  {
    language: "인도네시아어",
    excluded: ["Kamera Ultra Lebar Depan", "Kamera Lebar Belakang Ganda", "Kamera Ultra Lebar Belakang", "Kamera Telefoto Belakang"],
    triple: "Tiga Kamera Belakang",
    regular: ["Kamera Ganda Belakang", "Kamera Belakang", "Kamera Depan"],
  },
  {
    language: "벵골어",
    excluded: ["সামনের আলট্রা ওয়াইড ক্যামেরা", "পিছনের ডুয়াল ওয়াইড ক্যামেরা", "পিছনের আলট্রা ওয়াইড ক্যামেরা", "পিছনের টেলিফটো ক্যামেরা"],
    triple: "পিছনের ট্রিপল ক্যামেরা",
    regular: ["পিছনের ডুয়াল ক্যামেরা", "পিছনের ক্যামেরা", "সামনের ক্যামেরা"],
  },
];

const excludedCases = localizedLabels.flatMap(({ language, excluded }) => excluded.map((label) => ({ language, label })));
const regularCases = localizedLabels.flatMap(({ language, regular }) => regular.map((label) => ({ language, label })));

describe("IdcardCameraPolicy 다국어 라벨 필터", () => {
  const policy = new IdcardCameraPolicy();

  it.each(excludedCases)("$language '$label'은 zoom 범위가 1부터 시작해도 라벨로 제외한다", ({ label }) => {
    const device: CameraDeviceInfo = {
      deviceId: "excluded-camera",
      label,
      facingMode: "environment",
      capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities,
    };

    expect(policy.evaluateVideoInputDevices([device], true)).toEqual([
      { device, facingAssessment: "environment", passed: false, reasons: ["excluded_by_label"] },
    ]);
  });

  it.each(regularCases)("$language '$label'에는 제외 키워드가 없다", ({ label }) => {
    const device: CameraDeviceInfo = { deviceId: "regular-camera", label };

    expect(policy.selectVideoInputDevices([device])).toEqual([device]);
  });

  it.each(localizedLabels)("$language Triple은 zoom 근거가 없어도 라벨만으로 제외하지 않는다", ({ triple }) => {
    const device: CameraDeviceInfo = { deviceId: "triple-camera", label: triple, facingMode: "environment" };

    expect(policy.evaluateVideoInputDevices([device], true)).toEqual([
      { device, facingAssessment: "environment", passed: true, reasons: ["verified_environment"] },
    ]);
  });

  it.each(localizedLabels)("$language Triple도 유효한 zoom 범위에 1을 포함하면 허용하고 우선 선택한다", ({ triple, regular }) => {
    const tripleDevice: CameraDeviceInfo = {
      deviceId: "triple-camera",
      label: triple,
      facingMode: "environment",
      capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
    };
    const regularDevice: CameraDeviceInfo = { deviceId: "regular-camera", label: regular[1], facingMode: "environment" };
    const candidates = policy.selectVideoInputDevices([tripleDevice, regularDevice], true);

    expect(candidates).toEqual([tripleDevice, regularDevice]);
    expect(policy.orderPreferredDevices(candidates)).toEqual([tripleDevice, regularDevice]);
  });

  it.each(localizedLabels)("$language 비adaptive Triple에는 일반 장치와 같은 방향·zoom 조건을 적용한다", ({ triple }) => {
    const variants: (Pick<CameraDeviceInfo, "facingMode" | "capabilities"> & { passed: boolean; reasons: string[] })[] = [
      { facingMode: "user", capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities, passed: false, reasons: ["front_camera_not_allowed"] },
      { capabilities: { zoom: { min: 1, max: 10 } } as MediaTrackCapabilities, passed: true, reasons: ["mobile_unknown_compatibility"] },
      { facingMode: "user", capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { facingMode: "environment", capabilities: { zoom: { max: 10 } } as MediaTrackCapabilities, passed: true, reasons: ["verified_environment"] },
      { facingMode: "environment", capabilities: { zoom: { min: 0.5 } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { facingMode: "environment", capabilities: { zoom: { min: 1.1, max: 10 } } as MediaTrackCapabilities, passed: true, reasons: ["verified_environment"] },
      { facingMode: "environment", capabilities: { zoom: { min: 0.5, max: 0.9 } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { facingMode: "environment", capabilities: { zoom: { min: Number.NEGATIVE_INFINITY, max: 10 } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { facingMode: "environment", capabilities: { zoom: { min: 0.5, max: Number.POSITIVE_INFINITY } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
      { facingMode: "environment", capabilities: { zoom: { min: Number.NaN, max: 10 } } as MediaTrackCapabilities, passed: true, reasons: ["verified_environment"] },
      { facingMode: "environment", capabilities: { zoom: { min: 0.5, max: Number.NaN } } as MediaTrackCapabilities, passed: false, reasons: ["excluded_by_zoom_min"] },
    ];

    for (const { passed, reasons, ...variant } of variants) {
      const device: CameraDeviceInfo = { deviceId: "invalid-triple", label: triple, ...variant };
      const [decision] = policy.evaluateVideoInputDevices([device], true);

      expect(decision.passed).toBe(passed);
      expect(decision.reasons).toEqual(reasons);
    }
  });

  it.each(["CAMERA CỰC RỘNG MẶT SAU", "Camera (chụp   xa) mặt sau"])(
    "베트남어 대소문자·공백·괄호 변형 '%s'도 제외한다",
    (label) => {
      const device: CameraDeviceInfo = { deviceId: "excluded-variant", label };
      const [decision] = policy.evaluateVideoInputDevices([device]);

      expect(decision.passed).toBe(false);
      expect(decision.reasons).toContain("excluded_by_label");
    },
  );

  it.each([
    "Caméra GRAND   ANGLE arrière",
    "Caméra arrière de LONGUE   FOCALE",
    "Задняя ШИРОКОУГОЛЬНАЯ камера",
    "Камера с задним ТЕЛЕОБЪЕКТИВОМ",
    "KAMERA LEBAR BELAKANG",
  ])("추가 언어의 대소문자·공백 변형 '%s'도 제외한다", (label) => {
    const device: CameraDeviceInfo = { deviceId: "localized-variant", label };
    const [decision] = policy.evaluateVideoInputDevices([device]);

    expect(decision.passed).toBe(false);
    expect(decision.reasons).toContain("excluded_by_label");
  });

  it.each(["BA   CAMERA mặt sau", "TIGA   KAMERA Belakang"])("Triple의 대소문자·공백 변형 '%s'도 라벨만으로 제외하지 않는다", (label) => {
    const device: CameraDeviceInfo = { deviceId: "triple-variant", label, facingMode: "environment" };

    expect(policy.selectVideoInputDevices([device], true)).toEqual([device]);
  });

  it("일반 장치 이름을 Triple로 오인해 zoom 제외를 건너뛰지 않는다", () => {
    const devices: CameraDeviceInfo[] = [
      { deviceId: "toshiba", label: "Toshiba Camera" },
      { deviceId: "bailey", label: "Bailey Camera" },
      { deviceId: "xaver", label: "Camera Xaver" },
      { deviceId: "prestiga", label: "Prestiga Kamera" },
      { deviceId: "tiger", label: "Tiger Kamera" },
    ].map((device) => ({
      ...device,
      facingMode: "environment" as const,
      capabilities: { zoom: { min: 0.5, max: 10 } } as MediaTrackCapabilities,
    }));

    expect(policy.selectVideoInputDevices(devices)).toEqual([]);
  });
});
