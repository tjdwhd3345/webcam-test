# AGENTS.md

브라우저 WebAPI를 사용하여 카메라 권한 획득 및 실행로직을 검증하는 웹 페이지.

AS-IS 로직과 TO-BE 로직을 비교하여 TO-BE에서 AS-IS와 카메라 스트림에 차이가 없는지 검증한다. 

## 주요 기능 

- 카메라 권한 획득 및 실행 로직 검증
- AS-IS 로직과 TO-BE 로직 비교 분석
- 즉시 실행하여 권한획득 및 카메라 선별로직을 거쳐 카메라 실행을 확인
- 미디어 기기 목록을 조회 후 특정 미디어 스트림을 선택하여 카메라 실행 확인
- 현재 실행중인 미디어 스트림의 settings, capabilities 확인 

## 주요 폴더 구조
### AS-IS
```
src/
  types/
    camera.ts
    
  lib/
    camera_utils.ts
  
  hook/
    useCameraStream.ts
```
* `src/types/camera.ts`: 카메라 권한 획득 및 실행 로직을 검증하는 타입 정의
* `src/lib/camera_utils.ts`: 카메라 권한 요청 WebAPI 및 실행 로직을 검증하는 유틸리티 함수
* `src/hook`: AS-IS 카메라 스트림 관리 훅  


### TO-BE
```
src/
  domain/
    camera/  
      __tests__/
      camera_errors.ts
      idcard_camera_policy.ts
      prepare_idcard_camera_stream.ts

  infrastructure/
    camera/ 
      media_devices_camera_gateway.ts
  
  lib/
    auth/
      types/
        camera.ts
      camera.ts
    hook/
      use_idcard_camera_stream.ts
```
* `src/domain/camera`: 카메라 권한 요청 서비스 및 미디어 기기 선별 정책 (도메인 로직)
* `src/domain/camera/__tests__`: 도메인 로직 테스트 코드  
* `src/infrastructure/camera`: 카메라 권한 획득 로직을 WebAPI 분리 (인프라 로직)
* `src/lib/auth/types`: 카메라 권한 관련 타입 정의
* `src/lib/hook`: UI와 도메인 로직을 연결하는 서비스 훅 

## 유의사항 
* 로컬 실행은 HTTPS 기반 `vite dev server`에서 검증
* AS-IS 및 TO-BE 주요 로직은 명시적인 수정 요청사항을 통해서만 수정하며, 수정 요청사항이 없는 경우 수정하지 않는다.