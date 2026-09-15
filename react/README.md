# 카메라 리팩터링 검증 페이지

AS-IS `useCameraStream`과 TO-BE production 카메라 정책을 같은 브라우저 조건에서 비교하는 React/Vite 테스트벤치입니다. 한 번에 한 패널만 mount하여 두 구현이 동시에 카메라 스트림을 소유하지 않도록 구성했습니다.

## HTTPS로 실행

브라우저 카메라 API는 secure context가 필요합니다. 저장소에 준비된 로컬 인증서를 사용해 Vite HTTPS 서버를 실행합니다.

```bash
npm install
npm run dev
```

터미널에 표시된 `https://` 주소를 열고 로컬 인증서를 신뢰한 뒤 테스트합니다. 상단 runtime status에서 `isSecureContext`와 `getUserMedia`가 모두 `true`인지 먼저 확인합니다.

## 테스트 모드

- `AS-IS`: 기존 `useCameraStream`의 후면 카메라 선별, 해상도 fallback, 선택 장치 재생을 확인합니다.
- `TO-BE`: `useIdcardCameraStream`, `IdcardCameraPolicy`, `MediaDevicesCameraGateway`를 연결해 production 준비 결과, 장치별 정책 결정, strict-mobile 제약, 스트림 검증을 확인합니다.

TO-BE 소스 기준은 `ais-kyc.fe`의 커밋 `e1cb24c7`입니다. Sentry 연동만 이 테스트 앱 범위에서 제외했으며, 정책·use case·gateway·hook의 카메라 동작은 복사된 production 로직을 사용합니다.

## 수동 검증 순서

1. 상단에서 `AS-IS`를 선택하고 `카메라 권한` → `후면 카메라 실행`을 실행합니다.
2. 영상, 선택 장치, 해상도, settings/capabilities를 기록하고 `정지`합니다.
3. `TO-BE`로 전환합니다. 전환 직후 AS-IS 카메라 표시등이 꺼졌는지 확인합니다.
4. 모바일 브라우저에서는 기본 활성화된 `모바일 후면 카메라 강제`를 유지합니다. 데스크톱에서 모바일 조건을 재현할 때는 직접 체크합니다.
5. `후면 카메라 실행` 후 production 준비 결과가 `verified_environment`, `environment`, `preferred`, `valid`인지 확인합니다.
6. `카메라 목록 조회` 후 일반 후면 카메라는 통과하고 ultra/wide 계열은 `excluded_by_label` 또는 `excluded_by_zoom_min`으로 제외되는지 확인합니다.
7. 장치를 선택하고 `선택 장치 직접 재생 (진단)`을 실행해 직접 재생 검증과 실제 settings/capabilities를 확인합니다.
8. 다른 장치를 직접 재생하거나 모드를 전환했을 때 이전 카메라 표시등이 꺼지는지 확인합니다.
9. 브라우저가 `video.play()`를 거절하면 현재 자동 스트림 또는 직접 재생 스트림에 해당하는 오류만 화면에 표시되는지 확인합니다.

## 자동 검증

```bash
npm test -- --run
npm run build
```
