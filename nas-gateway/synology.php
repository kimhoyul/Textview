<?php
declare(strict_types=1);

final class GatewayError extends RuntimeException
{
    public function __construct(public readonly string $errorCode, public readonly int $httpStatus, string $message,
        public readonly ?array $diagnostic = null)
    {
        parent::__construct($message);
    }
}

function nas_error(string $code): GatewayError
{
    return match ($code) {
        'OTP_REQUIRED' => new GatewayError($code, 401, 'Secure SignIn의 6자리 인증 번호를 입력하세요.'),
        'OTP_INVALID' => new GatewayError($code, 401, '인증 번호를 확인한 뒤 다시 입력하세요.'),
        'APPROVAL_UNAVAILABLE' => new GatewayError($code, 409, '앱 승인 요청을 시작하지 못했습니다. 다시 시도하세요.'),
        'APPROVAL_DENIED' => new GatewayError($code, 401, 'Secure SignIn에서 로그인이 거절되었습니다.'),
        'APPROVAL_EXPIRED' => new GatewayError($code, 401, '승인 요청이 만료되었습니다. 다시 시도하세요.'),
        'AUTH_FAILED' => new GatewayError($code, 401, 'NAS 로그인 정보를 확인하세요.'),
        'SESSION_EXPIRED' => new GatewayError($code, 401, 'NAS 연결이 만료되었습니다. 다시 로그인하세요.'),
        'FORBIDDEN' => new GatewayError($code, 403, '이 요청 또는 파일에 접근할 권한이 없습니다.'),
        'INVALID_REQUEST' => new GatewayError($code, 400, '요청 내용을 확인하세요.'),
        'TOO_LARGE' => new GatewayError($code, 400, 'TXT 파일은 32 MB까지 가져올 수 있습니다.'),
        'RATE_LIMITED' => new GatewayError($code, 429, '요청이 많습니다. 잠시 후 다시 시도하세요.'),
        default => new GatewayError('NAS_UNREACHABLE', 502, 'NAS에 연결하지 못했습니다. 연결 상태를 확인하세요.'),
    };
}

/** Only fixed labels, bounded integers and booleans may leave the server. */
function nas_safe_approval_diagnostic(?array $value): ?array
{
    if ($value === null || !in_array($value['stage'] ?? null,
        ['password', 'approval-start', 'approval-status', 'approval-complete'], true)) { return null; }
    $types = [];
    foreach (is_array($value['availableTypes'] ?? null) ? $value['availableTypes'] : [] as $type) {
        if (in_array($type, ['amfa', 'otp', 'authenticator'], true)) { $types[] = $type; }
    }
    $types = array_values(array_unique($types));
    sort($types);
    return ['stage' => $value['stage'],
        'authVersion' => is_int($value['authVersion'] ?? null) && $value['authVersion'] >= 0 && $value['authVersion'] <= 7 ? $value['authVersion'] : 0,
        'upstreamCode' => is_int($value['upstreamCode'] ?? null) && $value['upstreamCode'] >= 0 && $value['upstreamCode'] <= 9999 ? $value['upstreamCode'] : 0,
        'availableTypes' => $types, 'proofPresent' => ($value['proofPresent'] ?? false) === true,
        'typesPresent' => ($value['typesPresent'] ?? false) === true];
}

/** Private temporary buffer; no unverified DSM response is sent to the browser. */
final class SynologyResponse
{
    public int $bytes = 0;
    public int $httpStatus = 0;
    public string $contentType = '';
    public string $contentDisposition = '';
    public bool $tooLarge = false;
    private mixed $stream;
    private string $path;

    public function __construct(string $directory)
    {
        if (!is_dir($directory) || is_link($directory)) {
            throw nas_error('NAS_UNREACHABLE');
        }
        $path = tempnam($directory, 'buffer-');
        if ($path === false || dirname($path) !== realpath($directory)) {
            if (is_string($path)) { @unlink($path); }
            throw nas_error('NAS_UNREACHABLE');
        }
        $this->path = $path;
        if (!chmod($path, 0600) || ($this->stream = fopen($path, 'w+b')) === false) {
            @unlink($path);
            throw nas_error('NAS_UNREACHABLE');
        }
    }

    public static function fromString(string $body, int $status, string $contentType, string $directory, array $headers = []): self
    {
        $response = new self($directory);
        $response->httpStatus = $status;
        $response->contentType = $contentType;
        foreach ($headers as $name => $value) {
            if (strcasecmp((string)$name, 'Content-Disposition') === 0 && is_string($value)) { $response->contentDisposition = $value; }
        }
        if (!$response->append($body, max(1, strlen($body)))) { throw nas_error('NAS_UNREACHABLE'); }
        return $response;
    }

    public function append(string $chunk, int $maximum): bool
    {
        $length = strlen($chunk);
        if ($length > $maximum - $this->bytes) { $this->tooLarge = true; return false; }
        $written = 0;
        while ($written < $length) {
            $part = fwrite($this->stream, substr($chunk, $written));
            if ($part === false || $part === 0) { return false; }
            $written += $part;
        }
        $this->bytes += $length;
        return true;
    }

    public function text(int $maximum): string
    {
        if ($this->bytes > $maximum || !rewind($this->stream)) { throw nas_error('NAS_UNREACHABLE'); }
        $body = stream_get_contents($this->stream);
        if ($body === false) { throw nas_error('NAS_UNREACHABLE'); }
        return $body;
    }

    public function json(int $maximum): array
    {
        try { $data = json_decode($this->text($maximum), true, 64, JSON_THROW_ON_ERROR); }
        catch (JsonException) { throw nas_error('NAS_UNREACHABLE'); }
        if (!is_array($data) || !isset($data['success']) || !is_bool($data['success'])) {
            throw nas_error('NAS_UNREACHABLE');
        }
        return $data;
    }

    public function output(): void
    {
        if (!rewind($this->stream)) { throw nas_error('NAS_UNREACHABLE'); }
        fpassthru($this->stream);
    }

    public function close(): void
    {
        if (isset($this->stream) && is_resource($this->stream)) { fclose($this->stream); }
        if (isset($this->path)) { @unlink($this->path); }
    }

    public function __destruct() { $this->close(); }
}

interface SynologyTransport
{
    public function post(string $url, array $fields, array $headers, int $maxBytes, int $timeout): SynologyResponse;
}

final class CurlSynologyTransport implements SynologyTransport
{
    public function __construct(private readonly array $config) {}

    public function post(string $url, array $fields, array $headers, int $maxBytes, int $timeout): SynologyResponse
    {
        if (!extension_loaded('curl')) { throw nas_error('NAS_UNREACHABLE'); }
        $response = new SynologyResponse($this->config['runtime_dir'] . '/buffers');
        $handle = curl_init($url);
        if ($handle === false) { throw nas_error('NAS_UNREACHABLE'); }
        $https = str_starts_with($url, 'https://');
        $options = [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
            CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/x-www-form-urlencoded', 'Accept: */*'], $headers),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => $https ? CURLPROTO_HTTPS : CURLPROTO_HTTP,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => min((int)$this->config['connect_timeout'], $timeout),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_VERBOSE => false,
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use ($response): int {
                if (strncasecmp($line, 'HTTP/', 5) === 0) { $response->contentDisposition = ''; }
                elseif (strncasecmp($line, 'Content-Disposition:', 20) === 0) { $response->contentDisposition = trim(substr($line, 20)); }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use ($response, $maxBytes): int {
                return $response->append($chunk, $maxBytes) ? strlen($chunk) : 0;
            },
        ];
        if (is_string($this->config['ca_file'] ?? null) && $this->config['ca_file'] !== '') {
            $options[CURLOPT_CAINFO] = $this->config['ca_file'];
        }
        try {
            if (!curl_setopt_array($handle, $options)) { throw nas_error('NAS_UNREACHABLE'); }
            $ok = curl_exec($handle);
            $response->httpStatus = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $response->contentType = (string)(curl_getinfo($handle, CURLINFO_CONTENT_TYPE) ?: '');
            if ($response->tooLarge) { throw nas_error($maxBytes === (int)$this->config['max_download_bytes'] ? 'TOO_LARGE' : 'NAS_UNREACHABLE'); }
            if ($ok === false) { throw nas_error('NAS_UNREACHABLE'); }
            return $response;
        } catch (Throwable $error) {
            $response->close();
            throw $error;
        } finally { curl_close($handle); }
    }
}

final class SynologyClient
{
    private readonly string $baseUrl;
    private readonly SynologyTransport $transport;
    private array $apis = [];
    private ?string $sid = null;
    private ?string $synoToken = null;
    private ?string $username = null;
    private string $sessionName = 'FileStation';

    public function __construct(private readonly array $config, ?SynologyTransport $transport = null)
    {
        $url = rtrim((string)($config['dsm_url'] ?? ''), '/');
        $parts = parse_url($url);
        $loopbackTest = ($config['allow_loopback_http_for_tests'] ?? false) === true
            && ($parts['scheme'] ?? '') === 'http'
            && in_array(strtolower((string)($parts['host'] ?? '')), ['127.0.0.1', '[::1]', '::1', 'localhost'], true);
        if (!is_array($parts) || (strtolower((string)($parts['scheme'] ?? '')) !== 'https' && !$loopbackTest)
            || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment']) || !empty($parts['path'])) {
            throw nas_error('NAS_UNREACHABLE');
        }
        $this->baseUrl = $url;
        $this->transport = $transport ?? new CurlSynologyTransport($config);
    }

    public static function validatePath(mixed $path, bool $allowRoot = true): string
    {
        if (!is_string($path) || $path === '' || strlen($path) > 4096 || $path[0] !== '/'
            || str_contains($path, '\\') || preg_match('//u', $path) !== 1
            || preg_match('/\p{Cc}/u', $path) === 1) { throw nas_error('INVALID_REQUEST'); }
        if ($path === '/') {
            if (!$allowRoot) { throw nas_error('INVALID_REQUEST'); }
            return $path;
        }
        foreach (explode('/', substr($path, 1)) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') { throw nas_error('INVALID_REQUEST'); }
        }
        return $path;
    }

    public static function isTxtPath(string $path): bool
    {
        return strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'txt';
    }

    public function restoreAuthentication(array $state): void
    {
        if (!is_string($state['sid'] ?? null) || $state['sid'] === '' || strlen($state['sid']) > 2048
            || preg_match('/[\x00-\x20\x7f]/', $state['sid']) === 1) { throw nas_error('SESSION_EXPIRED'); }
        $this->sid = $state['sid'];
        $this->synoToken = is_string($state['synotoken'] ?? null) ? $state['synotoken'] : null;
        if ($this->synoToken !== null && (strlen($this->synoToken) > 2048 || preg_match('/[\x00-\x20\x7f]/', $this->synoToken) === 1)) {
            throw nas_error('SESSION_EXPIRED');
        }
        $this->username = is_string($state['username'] ?? null) ? $state['username'] : null;
        $this->sessionName = in_array($state['sessionName'] ?? null, ['FileStation', 'webui'], true) ? $state['sessionName'] : 'FileStation';
        $this->apis = is_array($state['apis'] ?? null) ? $state['apis'] : [];
    }

    /** For the private PHP session only; never serialize this object to an API response. */
    public function authenticationState(): array
    {
        return ['sid' => $this->sid, 'synotoken' => $this->synoToken, 'username' => $this->username, 'apis' => $this->apis, 'sessionName' => $this->sessionName];
    }

    public function discover(bool $includeApproval = false): array
    {
        $response = $this->transport->post($this->baseUrl . '/webapi/entry.cgi', [
            'api' => 'SYNO.API.Info', 'version' => '1', 'method' => 'query',
            'query' => 'SYNO.API.Auth,SYNO.FileStation.List,SYNO.FileStation.Download'
                . ($includeApproval ? ',SYNO.SecureSignIn.Authenticator.Request' : ''),
        ], [], (int)$this->config['max_json_bytes'], (int)$this->config['api_timeout']);
        try {
            $data = $response->json((int)$this->config['max_json_bytes']);
            if ($response->httpStatus !== 200 || !$data['success'] || !is_array($data['data'] ?? null)) {
                throw nas_error('NAS_UNREACHABLE');
            }
            $names = ['SYNO.API.Auth', 'SYNO.FileStation.List', 'SYNO.FileStation.Download'];
            if ($includeApproval) { $names[] = 'SYNO.SecureSignIn.Authenticator.Request'; }
            foreach ($names as $api) {
                $item = $data['data'][$api] ?? null;
                if ($api === 'SYNO.SecureSignIn.Authenticator.Request' && $item === null) { throw nas_error('APPROVAL_UNAVAILABLE'); }
                if (!is_array($item) || !is_int($item['minVersion'] ?? null) || !is_int($item['maxVersion'] ?? null)
                    || $item['minVersion'] < 1 || $item['maxVersion'] < $item['minVersion'] || $item['maxVersion'] > 999
                    || !is_string($item['path'] ?? null)
                    || preg_match('#^(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.cgi$#D', $item['path']) !== 1) {
                    throw nas_error('NAS_UNREACHABLE');
                }
                $this->apis[$api] = $item;
            }
            $this->version('SYNO.API.Auth');
            $this->version('SYNO.FileStation.List');
            $this->version('SYNO.FileStation.Download');
            if ($includeApproval) { $this->version('SYNO.SecureSignIn.Authenticator.Request'); }
            return $this->apis;
        } finally { $response->close(); }
    }

    private function version(string $api): int
    {
        if (!isset($this->apis[$api])) { $this->discover($api === 'SYNO.SecureSignIn.Authenticator.Request'); }
        $info = $this->apis[$api];
        $min = (int)$info['minVersion'];
        $max = (int)$info['maxVersion'];
        if ($api === 'SYNO.SecureSignIn.Authenticator.Request') {
            if ($min > 1 || $max < 1) { throw nas_error('APPROVAL_UNAVAILABLE'); }
            return 1;
        }
        if ($api === 'SYNO.API.Auth') {
            $version = $min <= 6 && $max >= 6 ? 6 : min(7, $max);
            if ($version < max(3, $min)) { throw nas_error('NAS_UNREACHABLE'); }
            return $version;
        }
        if ($min > 2 || $max < 2) { throw nas_error('NAS_UNREACHABLE'); }
        return 2;
    }

    private function request(string $api, string $method, array $params, bool $authenticate, bool $download = false, ?int $timeout = null): SynologyResponse
    {
        $version = $this->version($api);
        $fields = ['api' => $api, 'version' => (string)$version, 'method' => $method];
        foreach ($params as $key => $value) {
            $fields[$key] = ($this->apis[$api]['requestFormat'] ?? '') === 'JSON'
                ? json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                : (is_array($value) ? json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : (string)$value);
        }
        $headers = [];
        if ($authenticate) {
            if ($this->sid === null) { throw nas_error('SESSION_EXPIRED'); }
            $fields['_sid'] = $this->sid;
            if ($this->synoToken !== null) {
                $fields['SynoToken'] = $this->synoToken;
                $headers[] = 'X-SYNO-TOKEN: ' . $this->synoToken;
            }
        }
        return $this->transport->post($this->baseUrl . '/webapi/' . $this->apis[$api]['path'], $fields, $headers,
            (int)$this->config[$download ? 'max_download_bytes' : 'max_json_bytes'],
            $timeout ?? (int)$this->config[$download ? 'download_timeout' : 'api_timeout']);
    }

    public static function checkApiResult(array $data, bool $login = false): void
    {
        if (($data['success'] ?? false) === true) { return; }
        $code = (int)($data['error']['code'] ?? 0);
        if ($login) {
            throw nas_error(match ($code) {
                403, 406 => 'OTP_REQUIRED', 404 => 'OTP_INVALID', 402 => 'FORBIDDEN',
                407 => 'RATE_LIMITED', default => 'AUTH_FAILED',
            });
        }
        throw nas_error(match ($code) {
            106, 107, 119 => 'SESSION_EXPIRED',
            105, 403, 404, 405, 407, 408 => 'FORBIDDEN',
            400, 412, 413 => 'INVALID_REQUEST',
            default => 'NAS_UNREACHABLE',
        });
    }

    private function jsonRequest(string $api, string $method, array $params, bool $authenticate, ?string $approvalStage = null): array
    {
        $response = null;
        $body = null;
        try {
            $response = $this->request($api, $method, $params, $authenticate);
            $body = $response->json((int)$this->config['max_json_bytes']);
            self::checkApiResult($body, $method === 'login');
            if ($response->httpStatus !== 200 || !is_array($body['data'] ?? null)) { throw nas_error('NAS_UNREACHABLE'); }
            return $body['data'];
        } catch (GatewayError $error) {
            throw $approvalStage === null ? $error : $this->approvalException($error, $approvalStage, $body);
        } finally { $response?->close(); }
    }

    public function login(string $username, string $password, ?string $otp = null): void
    {
        $this->discover();
        $params = ['account' => $username, 'passwd' => $password, 'session' => 'FileStation', 'format' => 'sid'];
        if ($this->version('SYNO.API.Auth') >= 6) { $params['enable_syno_token'] = 'yes'; }
        if ($otp !== null && $otp !== '') { $params['otp_code'] = $otp; }
        try {
            $data = $this->jsonRequest('SYNO.API.Auth', 'login', $params, false);
            $this->restoreAuthentication(['sid' => $data['sid'] ?? null, 'synotoken' => $data['synotoken'] ?? null,
                'username' => $username, 'apis' => $this->apis]);
        } finally { unset($params['passwd'], $params['otp_code'], $password, $otp); }
    }

    private static function approvalToken(mixed $value): bool
    {
        return is_string($value) && $value !== '' && strlen($value) <= 4096 && preg_match('/[\x00-\x20\x7f]/', $value) !== 1;
    }

    private function approvalException(GatewayError $error, string $stage, ?array $body = null): GatewayError
    {
        if ($error->diagnostic !== null) { return $error; }
        $errors = is_array($body['error']['errors'] ?? null) ? $body['error']['errors'] : [];
        $types = [];
        foreach (is_array($errors['types'] ?? null) ? $errors['types'] : [] as $type) {
            if (is_array($type) && is_string($type['type'] ?? null)) { $types[] = $type['type']; }
        }
        $info = $this->apis['SYNO.API.Auth'] ?? null;
        $version = is_array($info) ? (((int)$info['minVersion'] <= 6 && (int)$info['maxVersion'] >= 6) ? 6 : min(7, (int)$info['maxVersion'])) : 0;
        $diagnostic = nas_safe_approval_diagnostic(['stage' => $stage, 'authVersion' => $version,
            'upstreamCode' => is_int($body['error']['code'] ?? null) ? $body['error']['code'] : 0,
            'availableTypes' => $types, 'proofPresent' => is_string($errors['token'] ?? null) && $errors['token'] !== '',
            'typesPresent' => is_array($errors['types'] ?? null)]);
        return new GatewayError($error->errorCode, $error->httpStatus, $error->getMessage(), $diagnostic);
    }

    private function pendingApprovalType(array $pending, string $stage): string
    {
        // Only absent legacy fields default to amfa. An explicit null is invalid.
        $type = array_key_exists('approval_type', $pending) ? $pending['approval_type'] : 'amfa';
        if (!in_array($type, ['authenticator', 'amfa'], true)) {
            throw $this->approvalException(nas_error('APPROVAL_UNAVAILABLE'), $stage);
        }
        return $type;
    }

    private function approvalParams(string $username, string $proof, string $action, string $requestId = '', string $token = '', string $approvalType = 'amfa'): array
    {
        if (!in_array($approvalType, ['authenticator', 'amfa'], true)) {
            throw $this->approvalException(nas_error('APPROVAL_UNAVAILABLE'), $action === 'get_token' ? 'approval-complete' : 'approval-start');
        }
        return ['account' => $username, 'passwd' => $proof, 'type' => $approvalType, 'action' => $action,
            'request_id' => $requestId, 'authenticator_token' => $token, 'logintype' => 'local',
            'application' => 'DSM', 'client' => 'browser', 'session' => 'webui', 'format' => 'sid',
            'enable_syno_token' => 'yes', 'enable_device_token' => 'no', 'rememberme' => 0];
    }

    private function approvalAuth(array $params, string $stage = 'approval-start'): array
    {
        $response = null;
        $body = null;
        try {
            $response = $this->request('SYNO.API.Auth', 'login', $params, false);
            $body = $response->json((int)$this->config['max_json_bytes']);
            if (!$body['success']) {
                $code = (int)($body['error']['code'] ?? 0);
                if (in_array($code, [106, 119, 419], true)) { throw nas_error('APPROVAL_EXPIRED'); }
                if (in_array($code, [102, 103, 104, 403, 414], true)) { throw nas_error('APPROVAL_UNAVAILABLE'); }
                self::checkApiResult($body, true);
            }
            if ($response->httpStatus !== 200 || !is_array($body['data'] ?? null)) { throw nas_error('NAS_UNREACHABLE'); }
            return $body['data'];
        } catch (GatewayError $error) { throw $this->approvalException($error, $stage, $body); }
        finally { $response?->close(); }
    }

    public function loginApproval(string $username, string $password): array
    {
        $initial = ['account' => $username, 'passwd' => $password, 'logintype' => 'local',
            'client' => 'browser', 'session' => 'webui', 'format' => 'sid',
            'enable_syno_token' => 'yes', 'enable_device_token' => 'no', 'rememberme' => 0];
        $response = null;
        $body = null;
        try {
            $this->discover(true);
            $response = $this->request('SYNO.API.Auth', 'login', $initial, false);
            $body = $response->json((int)$this->config['max_json_bytes']);
            if ($body['success']) {
                if (is_string($body['data']['sid'] ?? null)) {
                    $this->restoreAuthentication(['sid' => $body['data']['sid'], 'synotoken' => $body['data']['synotoken'] ?? null,
                        'username' => $username, 'apis' => $this->apis, 'sessionName' => 'webui']);
                    $this->logout();
                }
                throw nas_error('APPROVAL_UNAVAILABLE');
            }
            $code = (int)($body['error']['code'] ?? 0);
            if (!in_array($code, [403, 414, 406], true)) {
                if (in_array($code, [102, 103, 104], true)) { throw nas_error('APPROVAL_UNAVAILABLE'); }
                self::checkApiResult($body, true);
            }
            $errors = $body['error']['errors'] ?? [];
            $offered = [];
            foreach (is_array($errors['types'] ?? null) ? $errors['types'] : [] as $type) {
                if (is_array($type) && in_array($type['type'] ?? null, ['authenticator', 'amfa'], true)) { $offered[] = $type['type']; }
            }
            $approvalType = in_array('authenticator', $offered, true) ? 'authenticator'
                : (in_array('amfa', $offered, true) ? 'amfa' : null);
            if ($approvalType === null) { throw nas_error('APPROVAL_UNAVAILABLE'); }
            $proof = $errors['token'] ?? null;
            if (!self::approvalToken($proof) || hash_equals($password, $proof)) { throw nas_error('APPROVAL_UNAVAILABLE'); }
            if ($response->httpStatus !== 200) { throw nas_error('NAS_UNREACHABLE'); }
        } catch (GatewayError $error) { throw $this->approvalException($error, 'password', $body); }
        finally { $response?->close(); unset($initial['passwd'], $password); }
        $data = $this->approvalAuth($this->approvalParams($username, $proof, 'get_status', '', '', $approvalType));
        if (!self::approvalToken($data['request_id'] ?? null)) { throw $this->approvalException(nas_error('APPROVAL_UNAVAILABLE'), 'approval-start'); }
        $pending = ['username' => $username, 'proof' => $proof, 'request_id' => $data['request_id'], 'apis' => $this->apis,
            'approval_type' => $approvalType];
        if (is_int($data['verify_number'] ?? null) || is_string($data['verify_number'] ?? null)) {
            $verify = (string)$data['verify_number'];
            if (preg_match('/^[0-9]{1,6}$/D', $verify) === 1) { $pending['verify_number'] = $verify; }
        }
        return $pending;
    }

    public function approvalStatus(array $pending): array
    {
        $this->apis = $pending['apis'];
        $this->pendingApprovalType($pending, 'approval-status');
        $data = $this->jsonRequest('SYNO.SecureSignIn.Authenticator.Request', 'status',
            ['account' => $pending['username'], 'request_id' => $pending['request_id']], false, 'approval-status');
        $state = $data['status'] ?? null;
        if (in_array($state, ['waiting', 'pending'], true)) { return ['state' => 'pending']; }
        if (in_array($state, ['timeout', 'expired'], true)) { throw $this->approvalException(nas_error('APPROVAL_EXPIRED'), 'approval-status'); }
        if (in_array($state, ['denied', 'revoked', 'corrupted'], true)) { throw $this->approvalException(nas_error('APPROVAL_DENIED'), 'approval-status'); }
        if ($state !== 'approved' || !self::approvalToken($data['token'] ?? null)) { throw $this->approvalException(nas_error('NAS_UNREACHABLE'), 'approval-status'); }
        return ['state' => 'approved', 'token' => $data['token']];
    }

    public function finishApproval(array $pending, string $token): void
    {
        if (!self::approvalToken($token)) { throw $this->approvalException(nas_error('APPROVAL_UNAVAILABLE'), 'approval-complete'); }
        $this->apis = $pending['apis'];
        $approvalType = $this->pendingApprovalType($pending, 'approval-complete');
        $data = $this->approvalAuth($this->approvalParams($pending['username'], $pending['proof'], 'get_token', $pending['request_id'], $token, $approvalType), 'approval-complete');
        try {
            $this->restoreAuthentication(['sid' => $data['sid'] ?? null, 'synotoken' => $data['synotoken'] ?? null,
                'username' => $pending['username'], 'apis' => $this->apis, 'sessionName' => 'webui']);
        } catch (GatewayError $error) { throw $this->approvalException($error, 'approval-complete'); }
    }

    public function cancelApproval(array $pending): void
    {
        try {
            $this->apis = $pending['apis'];
            $this->pendingApprovalType($pending, 'approval-status');
            $response = $this->request('SYNO.SecureSignIn.Authenticator.Request', 'revoke',
                ['account' => $pending['username'], 'request_id' => $pending['request_id']], false, false, (int)$this->config['logout_timeout']);
            $response->close();
        } catch (Throwable) { /* Local pending proof is cleared even when DSM is offline. */ }
    }

    public function listEntries(string $path, int $offset, int $limit): array
    {
        self::validatePath($path);
        if ($offset < 0 || $offset > 10000000 || $limit < 1 || $limit > 100) { throw nas_error('INVALID_REQUEST'); }
        $params = ['offset' => $offset, 'limit' => $limit, 'sort_by' => 'name', 'sort_direction' => 'asc',
            'additional' => $path === '/' ? ['time'] : ['size', 'time']];
        if ($path !== '/') { $params['folder_path'] = $path; }
        $data = $this->jsonRequest('SYNO.FileStation.List', $path === '/' ? 'list_share' : 'list', $params, true);
        $raw = $data[$path === '/' ? 'shares' : 'files'] ?? null;
        if (!is_array($raw) || !is_int($data['total'] ?? null) || $data['total'] < 0) { throw nas_error('NAS_UNREACHABLE'); }
        $entries = [];
        foreach ($raw as $item) {
            if (!is_array($item) || !is_string($item['name'] ?? null) || !is_bool($item['isdir'] ?? null)) { continue; }
            try { $itemPath = self::validatePath($item['path'] ?? null, false); }
            catch (GatewayError) { continue; }
            if (($path === '/' && substr_count($itemPath, '/') !== 1)
                || ($path !== '/' && dirname($itemPath) !== $path)) { continue; }
            if (!$item['isdir'] && !self::isTxtPath($itemPath)) { continue; }
            $size = $item['additional']['size'] ?? 0;
            $entry = ['name' => $item['name'], 'path' => $itemPath, 'isDir' => $item['isdir'],
                'size' => is_numeric($size) ? max(0, (int)$size) : 0];
            $modified = $item['additional']['time']['mtime'] ?? null;
            if (is_int($modified) && $modified >= 0) { $entry['modifiedAt'] = $modified * 1000; }
            $entries[] = $entry;
        }
        return ['ok' => true, 'path' => $path, 'entries' => $entries, 'total' => $data['total'],
            'offset' => $offset, 'nextOffset' => min($data['total'], $offset + count($raw)), 'limit' => $limit];
    }

    public function fileInfo(string $path): array
    {
        self::validatePath($path, false);
        if (!self::isTxtPath($path)) { throw nas_error('INVALID_REQUEST'); }
        $data = $this->jsonRequest('SYNO.FileStation.List', 'getinfo', ['path' => [$path], 'additional' => ['size', 'perm']], true);
        $item = $data['files'][0] ?? null;
        if (!is_array($item) || ($item['path'] ?? null) !== $path || ($item['isdir'] ?? null) !== false) { throw nas_error('FORBIDDEN'); }
        $size = $item['additional']['size'] ?? null;
        if (!is_int($size) || $size < 0) { throw nas_error('NAS_UNREACHABLE'); }
        if ($size > (int)$this->config['max_download_bytes']) { throw nas_error('TOO_LARGE'); }
        $permission = $item['additional']['perm'] ?? [];
        if (is_array($permission['acl'] ?? null) && array_key_exists('read', $permission['acl']) && $permission['acl']['read'] !== true) {
            throw nas_error('FORBIDDEN');
        }
        return ['path' => $path, 'name' => basename($path), 'size' => $size];
    }

    public function download(string $path): SynologyResponse
    {
        $this->fileInfo($path); // Permission and size are checked again for every download.
        $response = $this->request('SYNO.FileStation.Download', 'download', ['path' => [$path], 'mode' => 'download'], true, true);
        try {
            // DSM errors use JSON MIME, including errors with HTTP 200. A real TXT
            // attachment may itself contain any JSON; those bytes must stay intact.
            $mime = strtolower(trim(explode(';', $response->contentType)[0]));
            $jsonMime = $mime === 'application/json' || str_ends_with($mime, '+json');
            $attachment = preg_match('/^attachment(?:;|$)/i', $response->contentDisposition) === 1;
            $inspectEnvelope = $jsonMime && !$attachment;
            if ($inspectEnvelope && $response->bytes <= (int)$this->config['max_json_bytes']) {
                try { $body = json_decode($response->text((int)$this->config['max_json_bytes']), true, 32, JSON_THROW_ON_ERROR); }
                catch (JsonException) { $body = null; }
                if (is_array($body) && ($body['success'] ?? null) === false && is_array($body['error'] ?? null)) {
                    self::checkApiResult($body);
                }
            } elseif ($inspectEnvelope) { throw nas_error('NAS_UNREACHABLE'); }
            if ($response->httpStatus !== 200) {
                throw nas_error(in_array($response->httpStatus, [401, 403, 404], true) ? 'FORBIDDEN' : 'NAS_UNREACHABLE');
            }
            if ($response->bytes > (int)$this->config['max_download_bytes']) { throw nas_error('TOO_LARGE'); }
            return $response;
        } catch (Throwable $error) { $response->close(); throw $error; }
    }

    public function logout(): void
    {
        if ($this->sid === null) { return; }
        try {
            $response = $this->request('SYNO.API.Auth', 'logout', ['session' => $this->sessionName], true, false, (int)$this->config['logout_timeout']);
            $response->close();
        } catch (Throwable) { /* Local credentials are cleared even if DSM is offline. */ }
        finally { $this->sid = $this->synoToken = $this->username = null; }
    }
}
