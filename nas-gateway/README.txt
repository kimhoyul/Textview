Textview NAS 연결 서버

업로드 위치
/volume1/web/NASDownloader/textview-nas/

이 폴더의 api.php, synology.php, config.php를 위 위치에 함께 업로드하세요.
기존 Web Station의 PHP 8.4 프로필을 사용하세요.
PHP cURL과 세션 기능을 켜 두세요.
다른 Textview 파일을 이 서버 폴더에 넣을 필요는 없습니다.

연결 주소
https://chhc007.synology.me:9444/textview-nas/api.php

업로드 후 실행 확인 주소
https://chhc007.synology.me:9444/textview-nas/api.php?health=1
이 주소를 브라우저에서 열면 ready, php, curl, session, gatewayVersion을 확인할 수 있습니다.
gatewayVersion: nas4는 업로드한 서버 코드 버전입니다. 실제 NAS 승인 로그인 성공을 뜻하지 않습니다.
이 확인 요청은 로그인, NAS 조회, 세션 생성, 임시 파일 생성을 하지 않습니다.

DSM 연결 주소는 config.php의 https://chhc007.synology.me:9999입니다.
DSM 연결은 항상 인증서를 확인합니다. HTTP 전환이나 인증서 검사 해제는 하지 않습니다.
HTTPS 요청 정보가 PHP에 전달되어야 합니다. Web Station의 HTTPS 서비스로 실행하세요.
인증서 오류는 인증서 체인 또는 서버의 CA 설정을 수정하세요.
자체 CA를 사용한다면 config.php의 ca_file에 신뢰할 CA PEM 경로를 설정할 수 있습니다.

허용 출처
https://kimhoyul.github.io

공개 배포 기본 설정은 GitHub Pages 출처만 허용합니다.
허용 출처는 주소 전체가 정확하게 일치해야 합니다. 별표 출처는 사용하지 않습니다.
브라우저 쿠키를 사용하지 않습니다. Safari의 타사 쿠키에 의존하지 않습니다.

서버 저장 위치
config.php의 runtime_dir를 사용합니다.
기본 위치는 PHP 임시 폴더 아래의 textview-nas-문자열 폴더입니다.
이 위치는 웹 공개 폴더 밖에 있어야 합니다.
PHP 실행 사용자에게 폴더 생성과 쓰기 권한이 필요합니다.
폴더 권한은 0700입니다. 세션, 요청 제한 기록, 임시 다운로드 파일의 권한은 0600입니다.
DSM SID와 SynoToken은 이 서버의 PHP 세션에만 저장합니다.
관리자 비밀번호와 OTP는 저장하지 않습니다.
다운로드 임시 파일은 응답 검사를 마친 뒤 전송하고 삭제합니다.
PHP 파일이 실행되어야 합니다. PHP 소스가 다운로드되는 서버 설정으로 배포하면 안 됩니다.
config.php와 synology.php를 직접 요청해도 PHP가 실행되면 내용을 출력하지 않습니다.

로그인
기존 NAS 계정 이름과 비밀번호를 입력합니다.
Secure SignIn의 6자리 OTP를 사용할 수 있습니다.
승인 누르기 모드는 authMode: approval로 선택합니다. 기존 OTP 요청은 그대로 사용할 수 있습니다.
이 모드는 현재 NAS가 공개하는 Synology 로그인 정적 코드의 authenticator 또는 amfa 흐름을 사용합니다.
공개 개발 가이드의 OTP 로그인과는 별도입니다. DSM 또는 패키지 업데이트 후 재검증이 필요할 수 있습니다.
실제 NAS에서 승인 SID로 FileStation을 조회하는 동작은 사용자가 설치 후 확인해야 합니다.
nas3는 초기 승인 요청의 type, application을 제거하고 SDK의 webui 세션을 사용합니다.
nas4는 실제 NAS 응답의 승인 유형을 사용합니다. authenticator를 우선하고, 없을 때만 amfa를 사용합니다.
실제 NAS에서 확인한 403 응답은 authenticator와 otp 유형, 임시 증명 토큰을 제공했습니다.
authenticator SDK는 비밀번호 검증 후 받은 증명 토큰이 있으면 2FA 승인으로 처리합니다. passwordless 전용 유형이 아닙니다.
선택한 유형은 서버 대기 상태의 approval_type에만 저장합니다. 시작과 완료 요청에서 같은 유형을 사용합니다.
authenticator, amfa 외의 값과 명시적 null은 거부합니다. 기존 대기 상태에 필드가 없을 때만 amfa로 호환합니다.
후속 승인 요청의 application: DSM은 유지합니다. client: browser는 SDK 공통 코드가 추가하는 값입니다.
format: sid는 서버 연결에 필요하여 유지합니다. 설치 후 승인 로그인, 폴더 탐색, TXT 가져오기를 확인하세요.
서버는 승인 SID의 webui 세션 이름으로 로그아웃합니다. 기존 OTP 세션 이름은 FileStation입니다.
OTP가 필요하면 OTP_REQUIRED를 반환합니다. 같은 연결 토큰으로 OTP를 추가하여 다시 요청하세요.
승인 모드는 먼저 비밀번호를 확인합니다. NAS가 허용된 승인 유형과 임시 증명 토큰을 주는 경우만 승인 요청을 시작합니다.
원래 비밀번호와 OTP는 승인 대기 세션에 넣지 않습니다.
NAS가 승인 유형 또는 임시 토큰을 제공하지 않으면 선택한 승인 모드를 유지하고 시작 오류를 표시합니다.
승인 대기는 최대 120초입니다. 상태는 5초 간격으로 확인합니다.
승인 요청 시작은 IP별로 10분 동안 5번까지 허용합니다.
OTP_REQUIRED는 로그인 실패 횟수에 넣지 않습니다.
잘못된 로그인과 OTP는 IP별로 10분 동안 5번까지 허용합니다.
NAS 자체의 로그인 제한도 그대로 적용됩니다.

세션
유효한 요청이 없으면 15분 후 만료됩니다.
로그인 후 2시간이 지나면 사용 중이어도 다시 로그인해야 합니다.
만료 또는 로그아웃 시 서버의 DSM 세션을 최대 2초 동안 종료 시도합니다.
브라우저 토큰은 메모리에만 보관하세요. localStorage와 IndexedDB에 저장하지 마세요.
로그인 성공 시 sessionToken과 csrfToken이 바뀝니다. 기존 값을 둘 다 교체하세요.
새로고침 후에는 bootstrap과 로그인을 다시 실행합니다.
앱은 NAS 파일을 수정, 삭제, 업로드하지 않습니다.

API
로그인과 파일 요청은 POST이며 Content-Type: application/json입니다.
GET ?health=1은 위의 공개 실행 확인만 제공합니다.
OPTIONS는 허용 출처, POST, 허용 요청 헤더만 통과합니다.
bootstrap을 제외한 요청에는 아래 두 헤더가 모두 필요합니다.
Authorization: Bearer <sessionToken>
X-CSRF-Token: <csrfToken>
토큰이나 비밀번호를 URL에 넣지 마세요.
fetch의 credentials는 omit으로 설정하세요.

POST {"action":"bootstrap"}
응답: {"ok":true,"sessionToken":"...","csrfToken":"...","authenticated":false,"expiresIn":900}

POST {"action":"login","username":"계정 이름","password":"입력한 비밀번호","otp":"6자리 번호"}
otp는 처음 요청에서 생략할 수 있습니다.
응답: {"ok":true,"sessionToken":"새 토큰","csrfToken":"새 CSRF 토큰","authenticated":true,"username":"계정 이름","expiresIn":900}

POST {"action":"status"}
응답: {"ok":true,"authenticated":true 또는 false,"username":"로그인한 경우 계정 이름","expiresIn":900 이하}

POST {"action":"login","username":"계정 이름","password":"입력한 비밀번호","authMode":"approval"}
승인 대기 응답: {"ok":true,"authenticated":false,"expiresIn":남은 연결 초,"approval":{"state":"pending","expiresIn":120 이하,"verifyNumber":선택적 확인 숫자}}
request_id, 임시 증명 토큰, 승인 토큰은 브라우저에 반환하지 않습니다.
승인 대기 중에는 목록과 다운로드를 사용할 수 없습니다.

POST {"action":"approval_status"}
5초 간격으로 호출합니다. 대기 응답의 expiresIn은 늘어나지 않습니다.
승인이 완료되면 기존 login 성공과 같은 authenticated:true, 새 sessionToken, 새 csrfToken을 반환합니다.
동시 조회가 승인 완료를 받아도 SID 교환은 한 번만 실행합니다.
상태 확인과 SID 교환 동안 PHP 세션 잠금을 해제합니다.
취소 또는 새 요청 뒤 도착한 승인 결과는 버립니다. 이미 발급된 SID는 종료합니다.

POST {"action":"approval_cancel"}
현재 요청을 취소합니다. NAS 취소가 실패해도 서버의 대기 증명 토큰은 지웁니다.
응답: {"ok":true,"authenticated":false,"expiresIn":남은 연결 초}
logout과 세션 만료도 대기 요청을 취소합니다.

POST {"action":"list","path":"/","offset":0,"limit":100}
/는 접근 가능한 공유 폴더를 표시합니다.
공유 폴더 안에서는 /공유폴더/하위폴더 형태의 경로를 사용합니다.
응답: {"ok":true,"path":"/","entries":[{"name":"이름","path":"/경로","isDir":true 또는 false,"size":바이트,"modifiedAt":선택적 Unix 밀리초}],"total":DSM 원본 목록 총수,"offset":요청한 시작점,"nextOffset":DSM 원본 행수를 더한 시작점,"limit":요청한 제한,"expiresIn":남은 세션 초}
폴더와 TXT만 entries에 포함합니다. 다른 파일은 숨깁니다.
total은 숨긴 파일을 포함한 DSM 원본 총수입니다.
다음 목록은 entries.length가 아니라 nextOffset부터 요청하세요.
entries가 비어도 nextOffset < total이면 다음 목록이 있을 수 있습니다.

POST {"action":"download","path":"/공유폴더/소설.txt"}
매 요청에서 DSM의 파일 정보와 읽기 권한을 확인합니다.
TXT만 허용합니다. 파일 크기는 32 MB까지 허용합니다.
DSM 다운로드 중에도 32 MB 제한을 다시 확인합니다.
성공 응답은 application/octet-stream 파일입니다.
X-Textview-Filename의 값은 decodeURIComponent로 읽으면 원래 UTF-8 파일 이름입니다.
X-Textview-Session-Expires-In은 다운로드 응답 시점의 남은 세션 초입니다.
다운로드 중에는 PHP 세션 잠금을 해제합니다. 상태 확인과 로그아웃을 함께 실행할 수 있습니다.
오류 응답은 파일 대신 JSON입니다. 응답 성공과 Content-Type을 먼저 확인하세요.

POST {"action":"logout"}
응답: {"ok":true}

오류 형식
{"ok":false,"error":{"code":"오류 코드","message":"한국어 안내"}}
OTP_REQUIRED / OTP_INVALID / AUTH_FAILED / SESSION_EXPIRED: HTTP 401
APPROVAL_DENIED / APPROVAL_EXPIRED: HTTP 401
APPROVAL_UNAVAILABLE: HTTP 409; 승인 요청 시작 실패입니다. 선택한 승인 모드를 자동으로 바꾸지 않습니다.
FORBIDDEN: HTTP 403
INVALID_REQUEST / TOO_LARGE: HTTP 400
RATE_LIMITED: HTTP 429
NAS_UNREACHABLE: HTTP 502
POST가 아닌 실제 요청: INVALID_REQUEST, HTTP 405
DSM의 전체 오류 응답이나 SID를 브라우저에 반환하지 않습니다.
승인 오류의 diagnostic에는 아래 정보만 포함할 수 있습니다.
stage: password / approval-start / approval-status / approval-complete 중 하나
authVersion, upstreamCode: 제한된 범위의 정수
availableTypes: amfa / otp / authenticator 중 확인된 유형만
proofPresent, typesPresent: true 또는 false
비밀번호, OTP, 계정 이름, 요청 ID, 증명 토큰, 승인 토큰, SID, 원문 응답은 진단 정보에서 제외합니다.

확인 순서
1. 세 PHP 파일을 업로드합니다.
2. Textview NAS 화면의 연결 주소를 위 api.php 주소로 설정합니다.
3. 연결 확인을 실행합니다. bootstrap은 DSM 계정 로그인을 하지 않습니다.
4. NAS 로그인과 OTP를 확인합니다.
5. 공유 폴더와 TXT를 확인합니다.
6. TXT를 기존 책장에 추가합니다.
7. 인터넷 연결 없이 추가한 TXT를 읽습니다.
8. 로그아웃 후 목록과 다운로드가 차단되는지 확인합니다.

서버 테스트 경계
synology.php는 정의만 로드합니다.
SynologyTransport::post(url, fields, headers, maxBytes, timeout): SynologyResponse를 주입할 수 있습니다.
SynologyResponse::fromString(body, status, contentType, privateBufferDirectory, optionalHeaders)는 모의 응답을 만듭니다.
optionalHeaders의 Content-Disposition으로 실제 TXT 첨부를 구분할 수 있습니다.
SynologyClient(config, optionalTransport)는 서버 설정만 받습니다.
public: discover, login, loginApproval, approvalStatus, finishApproval, cancelApproval, restoreAuthentication, authenticationState, listEntries, fileInfo, download, logout.
static public: validatePath, isTxtPath, checkApiResult.
서버 테스트에서만 allow_loopback_http_for_tests=true와 HTTP loopback 주소를 함께 사용할 수 있습니다.
기본 설정에서는 이 예외가 꺼져 있습니다. 원격 HTTP 주소는 예외로도 허용하지 않습니다.
TEXTVIEW_NAS_LIBRARY_ONLY 상수를 정의한 뒤 api.php를 include하면 자동 요청 처리를 생략합니다.
nas_run(testConfig, testTransport)로 모의 서버 요청을 검증할 수 있습니다.
테스트 전용 설정은 브라우저 요청으로 바꿀 수 없습니다.

공식 근거
https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf
https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf

승인 흐름의 실제 Synology 정적 코드 근거
https://chhc007.synology.me:9999/webman/3rdparty/SecureSignIn/login-dist/SecureSignInLogin.2698e9f5d7ca5b10a4ca.68.js
https://chhc007.synology.me:9999/webman/login/dist/dsm.login.bundle.9698264d6a09fbd5796a.386.js
https://chhc007.synology.me:9999/webman/3rdparty/SecureSignIn/login-dist/SecureSignInLogin.69281bbef67fe247f9a0.804.js
https://chhc007.synology.me:9999/webman/sds/dist/dsm.common.bundle.js?v=1780907689
