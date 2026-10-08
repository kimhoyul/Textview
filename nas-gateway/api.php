<?php
declare(strict_types=1);

require_once __DIR__ . '/synology.php';

function nas_private_directory(string $directory): void
{
    if (is_link($directory) || (!is_dir($directory) && !mkdir($directory, 0700, true))) { throw nas_error('NAS_UNREACHABLE'); }
    if (!chmod($directory, 0700) || !is_writable($directory)) { throw nas_error('NAS_UNREACHABLE'); }
    if (function_exists('posix_geteuid') && fileowner($directory) !== posix_geteuid()) { throw nas_error('NAS_UNREACHABLE'); }
}

function nas_prepare_runtime(array $config): void
{
    $runtime = (string)($config['runtime_dir'] ?? '');
    if ($runtime === '') { throw nas_error('NAS_UNREACHABLE'); }
    nas_private_directory($runtime);
    $resolved = realpath($runtime);
    if ($resolved === false) { throw nas_error('NAS_UNREACHABLE'); }
    foreach ([__DIR__, $_SERVER['DOCUMENT_ROOT'] ?? ''] as $webDirectory) {
        $webRoot = $webDirectory !== '' ? realpath($webDirectory) : false;
        if ($webRoot !== false && (strcasecmp($resolved, $webRoot) === 0
            || str_starts_with(strtolower($resolved . DIRECTORY_SEPARATOR), strtolower($webRoot . DIRECTORY_SEPARATOR)))) {
            throw nas_error('NAS_UNREACHABLE');
        }
    }
    foreach (['sessions', 'rates', 'buffers'] as $name) { nas_private_directory($runtime . '/' . $name); }
}

function nas_request_header(string $name): string
{
    $contentKey = match (strtolower($name)) { 'content-type' => 'CONTENT_TYPE', 'content-length' => 'CONTENT_LENGTH', default => null };
    if ($contentKey !== null && is_string($_SERVER[$contentKey] ?? null)) { return $_SERVER[$contentKey]; }
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (is_string($_SERVER[$serverKey] ?? null)) { return $_SERVER[$serverKey]; }
    if (strcasecmp($name, 'Authorization') === 0 && is_string($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null)) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $key => $value) {
            if (strcasecmp((string)$key, $name) === 0 && is_string($value)) { return $value; }
        }
    }
    return '';
}

function nas_common_headers(): void
{
    header('Cache-Control: no-store, max-age=0');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('Vary: Origin');
}

function nas_json(array $body, int $status = 200): never
{
    if (session_status() === PHP_SESSION_ACTIVE && !session_write_close()) { throw nas_error('NAS_UNREACHABLE'); }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function nas_https(): bool
{
    return (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && strcasecmp((string)$_SERVER['HTTPS'], 'off') !== 0)
        || strtolower((string)($_SERVER['REQUEST_SCHEME'] ?? '')) === 'https';
}

function nas_cors(array $config): bool
{
    $origin = nas_request_header('Origin');
    if ($origin === '' || !in_array($origin, $config['allowed_origins'], true)) { throw nas_error('FORBIDDEN'); }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Expose-Headers: X-Textview-Filename, X-Textview-Session-Expires-In, Content-Disposition, Content-Length');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'OPTIONS') { return false; }
    if (strtoupper(nas_request_header('Access-Control-Request-Method')) !== 'POST') { throw nas_error('FORBIDDEN'); }
    $requested = nas_request_header('Access-Control-Request-Headers');
    foreach ($requested === '' ? [] : explode(',', $requested) as $name) {
        if (!in_array(strtolower(trim($name)), ['authorization', 'content-type', 'x-csrf-token'], true)) { throw nas_error('FORBIDDEN'); }
    }
    header('Access-Control-Allow-Methods: POST');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-CSRF-Token');
    header('Access-Control-Max-Age: 600');
    http_response_code(204);
    return true;
}

/** A single protected, locked record per actual peer IP; proxy headers are not trusted. */
final class NasRateBucket
{
    private mixed $file;
    private array $record;
    private readonly int $now;
    private bool $closed = false;

    public function __construct(private readonly array $config, string $ip)
    {
        $this->now = time();
        $directory = $config['runtime_dir'] . '/rates';
        $path = $directory . '/' . hash('sha256', $ip) . '.json';
        if (!is_file($path)) {
            $files = glob($directory . '/*.json') ?: [];
            if (count($files) >= (int)$config['max_rate_files']) {
                foreach (array_slice($files, 0, 128) as $candidate) {
                    if (is_link($candidate) || filemtime($candidate) > $this->now - 2 * (int)$config['rate_window']) { continue; }
                    $old = fopen($candidate, 'r+');
                    if ($old !== false) {
                        if (flock($old, LOCK_EX | LOCK_NB)) { @unlink($candidate); flock($old, LOCK_UN); }
                        fclose($old);
                    }
                }
                if (count(glob($directory . '/*.json') ?: []) >= (int)$config['max_rate_files']) { throw nas_error('RATE_LIMITED'); }
            }
        }
        if (is_link($path) || ($this->file = fopen($path, 'c+')) === false) { throw nas_error('NAS_UNREACHABLE'); }
        if (!chmod($path, 0600)) { fclose($this->file); throw nas_error('NAS_UNREACHABLE'); }
        if (!flock($this->file, LOCK_EX | LOCK_NB)) { fclose($this->file); throw nas_error('RATE_LIMITED'); }
        $raw = stream_get_contents($this->file, 65536);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        $this->record = [];
        foreach (['requests', 'bootstraps', 'failures', 'approvals'] as $kind) {
            $values = is_array($decoded[$kind] ?? null) ? $decoded[$kind] : [];
            $this->record[$kind] = array_values(array_filter($values,
                fn($stamp): bool => is_int($stamp) && $stamp >= $this->now - (int)$config['rate_window']));
        }
    }

    public function consume(string $action): void
    {
        if (count($this->record['requests']) >= (int)$this->config['max_requests']) { throw nas_error('RATE_LIMITED'); }
        if ($action === 'bootstrap' && count($this->record['bootstraps']) >= (int)$this->config['max_bootstraps']) { throw nas_error('RATE_LIMITED'); }
        $this->record['requests'][] = $this->now;
        if ($action === 'bootstrap') { $this->record['bootstraps'][] = $this->now; }
    }

    public function checkLogin(): void
    {
        if (count($this->record['failures']) >= (int)$this->config['max_login_failures']) { throw nas_error('RATE_LIMITED'); }
    }

    public function failedLogin(): void { $this->record['failures'][] = time(); }

    public function beginApproval(): void
    {
        if (count($this->record['approvals']) >= (int)($this->config['max_approvals'] ?? 5)) { throw nas_error('RATE_LIMITED'); }
        $this->record['approvals'][] = time();
    }

    public function close(): void
    {
        if ($this->closed || !is_resource($this->file)) { return; }
        $this->closed = true;
        $data = json_encode($this->record, JSON_THROW_ON_ERROR);
        $ok = rewind($this->file) && ftruncate($this->file, 0) && fwrite($this->file, $data) === strlen($data) && fflush($this->file);
        flock($this->file, LOCK_UN);
        fclose($this->file);
        if (!$ok) { throw nas_error('NAS_UNREACHABLE'); }
    }

    public function __destruct() { try { $this->close(); } catch (Throwable) {} }
}

function nas_best_effort_logout(array $config, array $state, ?SynologyTransport $transport = null): void
{
    try { $client = new SynologyClient($config, $transport); $client->restoreAuthentication($state); $client->logout(); }
    catch (Throwable) { /* No password, OTP, or upstream error is logged. */ }
}

function nas_destroy_session(array $config, ?SynologyTransport $transport = null): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) { return; }
    nas_cancel_pending($config, $transport);
    $dsm = is_array($_SESSION['dsm'] ?? null) ? $_SESSION['dsm'] : [];
    unset($_SESSION['dsm']);
    if ($dsm !== []) { nas_best_effort_logout($config, $dsm, $transport); }
    $_SESSION = [];
    session_destroy();
    session_id('');
}

function nas_cancel_pending(array $config, ?SynologyTransport $transport = null): void
{
    $pending = is_array($_SESSION['approval'] ?? null) ? $_SESSION['approval'] : null;
    unset($_SESSION['approval']);
    if ($pending !== null) {
        try { (new SynologyClient($config, $transport))->cancelApproval($pending); }
        catch (Throwable) {}
    }
}

function nas_approval_reply(array $config, array $pending): array
{
    $data = ['ok' => true, 'authenticated' => false, 'expiresIn' => nas_expiry($config, $_SESSION),
        'approval' => ['state' => 'pending', 'expiresIn' => max(0, (int)$pending['deadline'] - time())]];
    if (isset($pending['verify_number'])) { $data['approval']['verifyNumber'] = (int)$pending['verify_number']; }
    return $data;
}

/** Resume only this approval generation; a cancelled/replaced flow is never restored. */
function nas_resume_approval(array $config, array $context, bool $checkClaim = false): bool
{
    if (session_status() === PHP_SESSION_ACTIVE) { session_abort(); }
    nas_session_options($config);
    session_id($context['id']);
    if (!session_start()) { throw nas_error('NAS_UNREACHABLE'); }
    if (!hash_equals($context['id'], session_id())) {
        $_SESSION = []; session_destroy(); session_id('');
        return false;
    }
    $pending = $_SESSION['approval'] ?? null;
    if (($_SESSION['origin'] ?? null) !== $context['origin'] || !is_string($_SESSION['csrf'] ?? null)
        || !hash_equals($context['csrf'], $_SESSION['csrf']) || !is_array($pending)
        || ($pending['flow_id'] ?? null) !== $context['flow_id']
        || ($checkClaim && ($pending['claim'] ?? null) !== $context['claim'])) {
        session_abort();
        return false;
    }
    return true;
}

/** Reopen only the exact original session after an unlocked download failed. */
function nas_invalidate_download_session(array $config, array $context, ?SynologyTransport $transport = null): void
{
    try {
        if (session_status() === PHP_SESSION_ACTIVE) { session_abort(); }
        nas_session_options($config);
        session_id($context['id']);
        if (!session_start()) { return; }
        if (!hash_equals($context['id'], session_id())) {
            // Strict mode rejected a deleted ID. Remove its new anonymous replacement.
            $_SESSION = [];
            session_destroy();
            session_id('');
            return;
        }
        if (($_SESSION['origin'] ?? null) === $context['origin']
            && is_string($_SESSION['csrf'] ?? null) && hash_equals($context['csrf'], $_SESSION['csrf'])
            && is_string($_SESSION['dsm']['sid'] ?? null) && hash_equals($context['sid'], $_SESSION['dsm']['sid'])) {
            nas_destroy_session($config, $transport);
        } else { session_abort(); }
    } catch (Throwable) {
        if (session_status() === PHP_SESSION_ACTIVE) { session_abort(); }
    }
}

function nas_session_options(array $config): void
{
    if (session_status() === PHP_SESSION_ACTIVE) { throw nas_error('NAS_UNREACHABLE'); }
    foreach ([
        'session.use_cookies' => '0', 'session.use_only_cookies' => '0',
        'session.use_strict_mode' => '1', 'session.use_trans_sid' => '0',
        'session.serialize_handler' => 'php_serialize', 'session.gc_probability' => '0',
        'session.gc_maxlifetime' => (string)$config['absolute_ttl'],
    ] as $name => $value) {
        // PHP 8.4 deprecates the value 0 for use_only_cookies. Cookies remain
        // disabled; the explicitly supplied bearer ID is still the only source.
        $previous = $name === 'session.use_only_cookies' ? @ini_set($name, $value) : ini_set($name, $value);
        if ($previous === false) { throw nas_error('NAS_UNREACHABLE'); }
    }
    if (PHP_VERSION_ID < 80400) {
        ini_set('session.sid_length', '48');
        ini_set('session.sid_bits_per_character', '6');
    }
    session_name('TEXTVIEW_NAS');
    session_save_path($config['runtime_dir'] . '/sessions');
    session_cache_limiter('');
}

/** Bounded cleanup also attempts to end stale DSM sessions; locked live sessions are skipped. */
function nas_cleanup_sessions(array $config, ?SynologyTransport $transport = null): void
{
    $now = time();
    $files = glob($config['runtime_dir'] . '/sessions/sess_*') ?: [];
    $removed = 0;
    $logouts = 0;
    foreach ($files as $path) {
        if ($removed >= 16 || is_link($path) || filemtime($path) > $now - (int)$config['idle_ttl']) { continue; }
        $file = fopen($path, 'r+');
        if ($file === false) { continue; }
        if (!flock($file, LOCK_EX | LOCK_NB)) { fclose($file); continue; }
        try {
            $raw = stream_get_contents($file, 65536);
            $data = is_string($raw) && $raw !== '' ? @unserialize($raw, ['allowed_classes' => false]) : null;
            $expired = !is_array($data)
                || $now - (int)($data['last_seen'] ?? 0) >= (int)$config['idle_ttl']
                || $now - (int)($data['created_at'] ?? 0) >= (int)$config['absolute_ttl'];
            if (!$expired) { continue; }
            if (is_array($data['dsm'] ?? null) || is_array($data['approval'] ?? null)) {
                if ($logouts >= 2) { continue; }
                $logouts++;
                if (is_array($data['dsm'] ?? null)) { nas_best_effort_logout($config, $data['dsm'], $transport); }
                if (is_array($data['approval'] ?? null)) {
                    try { (new SynologyClient($config, $transport))->cancelApproval($data['approval']); } catch (Throwable) {}
                }
            }
            ftruncate($file, 0);
            @unlink($path);
            $removed++;
        } finally { flock($file, LOCK_UN); fclose($file); }
    }
    if (count(glob($config['runtime_dir'] . '/sessions/sess_*') ?: []) >= (int)$config['max_sessions']) { throw nas_error('RATE_LIMITED'); }
}

function nas_start_session(array $config, string $origin, bool $bootstrap, ?SynologyTransport $transport = null): void
{
    nas_session_options($config);
    if ($bootstrap) {
        nas_cleanup_sessions($config, $transport);
        // An explicit server-generated ID prevents PHP from consulting a URL SID.
        session_id(session_create_id());
    } else {
        if (preg_match('/^Bearer ([A-Za-z0-9,-]{22,128})$/D', nas_request_header('Authorization'), $matches) !== 1) {
            throw nas_error('SESSION_EXPIRED');
        }
        session_id($matches[1]);
    }
    if (!session_start()) { throw nas_error('NAS_UNREACHABLE'); }
    if ($bootstrap) {
        $_SESSION = ['created_at' => time(), 'last_seen' => time(), 'origin' => $origin, 'csrf' => bin2hex(random_bytes(32))];
        return;
    }
    if (!hash_equals($matches[1], session_id()) || !is_int($_SESSION['created_at'] ?? null)
        || !is_int($_SESSION['last_seen'] ?? null) || !is_string($_SESSION['csrf'] ?? null)) {
        nas_destroy_session($config, $transport);
        throw nas_error('SESSION_EXPIRED');
    }
    if (($_SESSION['origin'] ?? '') !== $origin || !hash_equals($_SESSION['csrf'], nas_request_header('X-CSRF-Token'))) {
        throw nas_error('FORBIDDEN');
    }
    $now = time();
    if ($now - $_SESSION['last_seen'] >= (int)$config['idle_ttl'] || $now - $_SESSION['created_at'] >= (int)$config['absolute_ttl']) {
        nas_destroy_session($config, $transport);
        throw nas_error('SESSION_EXPIRED');
    }
    $_SESSION['last_seen'] = $now;
}

function nas_status(array $config, bool $tokens = false): array
{
    $authenticated = is_array($_SESSION['dsm'] ?? null) && is_string($_SESSION['dsm']['sid'] ?? null);
    $data = ['ok' => true, 'authenticated' => $authenticated, 'expiresIn' => nas_expiry($config, $_SESSION)];
    if ($authenticated) { $data['username'] = $_SESSION['dsm']['username']; }
    elseif (is_array($_SESSION['approval'] ?? null)) { $data['approval'] = nas_approval_reply($config, $_SESSION['approval'])['approval']; }
    if ($tokens) { $data['sessionToken'] = session_id(); $data['csrfToken'] = $_SESSION['csrf']; }
    return $data;
}

function nas_expiry(array $config, array $state): int
{
    $now = time();
    return max(0, min((int)$state['last_seen'] + (int)$config['idle_ttl'] - $now,
        (int)$state['created_at'] + (int)$config['absolute_ttl'] - $now));
}

/** Optional arguments are for server-side tests only; no request can change the config or transport. */
function nas_run(?array $configOverride = null, ?SynologyTransport $transport = null): void
{
    ini_set('display_errors', '0');
    ini_set('log_errors', '0');
    error_reporting(E_ALL);
    set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
        if (!(error_reporting() & $severity)) { return true; }
        throw new ErrorException('Gateway operation failed.', 0, $severity, $file, $line);
    });
    umask(0077);
    $config = [];
    $rate = null;
    $download = null;
    $downloadContext = null;
    $approvalContext = null;
    try {
        $config = $configOverride ?? require __DIR__ . '/config.php';
        nas_common_headers();
        if (($config['require_https'] ?? true) && !nas_https()) { throw nas_error('FORBIDDEN'); }
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && ($_SERVER['QUERY_STRING'] ?? '') === 'health=1') {
            if (nas_request_header('Origin') !== '') { nas_cors($config); }
            $phpReady = PHP_VERSION_ID >= 80400;
            $curlReady = extension_loaded('curl');
            $sessionReady = extension_loaded('session');
            nas_json(['ok' => true, 'ready' => $phpReady && $curlReady && $sessionReady,
                'php' => PHP_VERSION, 'curl' => $curlReady, 'session' => $sessionReady,
                'gatewayVersion' => (string)($config['gateway_version'] ?? 'nas4')]);
        }
        if (nas_cors($config)) { return; }
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            header('Allow: POST, OPTIONS');
            throw new GatewayError('INVALID_REQUEST', 405, 'POST 요청만 사용할 수 있습니다.');
        }
        if (($_SERVER['QUERY_STRING'] ?? '') !== '') { throw nas_error('INVALID_REQUEST'); }
        if (strtolower(trim(explode(';', nas_request_header('Content-Type'))[0])) !== 'application/json') { throw nas_error('INVALID_REQUEST'); }
        $maximum = (int)$config['max_request_bytes'];
        if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > $maximum) { throw nas_error('INVALID_REQUEST'); }
        $raw = file_get_contents('php://input', false, null, 0, $maximum + 1);
        if (!is_string($raw) || strlen($raw) > $maximum) { throw nas_error('INVALID_REQUEST'); }
        try { $input = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
        catch (JsonException) { throw nas_error('INVALID_REQUEST'); }
        unset($raw);
        $action = is_array($input) && is_string($input['action'] ?? null) ? $input['action'] : '';
        $allowed = match ($action) {
            'bootstrap', 'status', 'logout', 'approval_status', 'approval_cancel' => ['action'],
            'login' => ['action', 'username', 'password', 'otp', 'authMode'],
            'list' => ['action', 'path', 'offset', 'limit'],
            'download' => ['action', 'path'],
            default => throw nas_error('INVALID_REQUEST'),
        };
        foreach (array_keys($input) as $key) { if (!in_array($key, $allowed, true)) { throw nas_error('INVALID_REQUEST'); } }
        nas_prepare_runtime($config);
        $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $rate = new NasRateBucket($config, $ip);
        $rate->consume($action);
        if ($action === 'login') { $rate->checkLogin(); }
        else { $rate->close(); $rate = null; }
        $origin = nas_request_header('Origin');
        nas_start_session($config, $origin, $action === 'bootstrap', $transport);
        if ($action === 'bootstrap') { nas_json(nas_status($config, true)); }
        if ($action === 'status') { nas_json(nas_status($config)); }
        if ($action === 'logout') { nas_destroy_session($config, $transport); nas_json(['ok' => true]); }
        if ($action === 'approval_cancel') { nas_cancel_pending($config, $transport); nas_json(nas_status($config)); }
        $client = new SynologyClient($config, $transport);
        if ($action === 'approval_status') {
            $pending = $_SESSION['approval'] ?? null;
            if (!is_array($pending)) { throw nas_error('APPROVAL_EXPIRED'); }
            if (time() >= (int)$pending['deadline']) { nas_cancel_pending($config, $transport); throw nas_error('APPROVAL_EXPIRED'); }
            if (($pending['claim'] ?? null) !== null || time() < (int)$pending['next_poll']) { nas_json(nas_approval_reply($config, $pending)); }
            $_SESSION['approval']['next_poll'] = time() + (int)($config['approval_poll_interval'] ?? 5);
            $approvalContext = ['id' => session_id(), 'origin' => $_SESSION['origin'], 'csrf' => $_SESSION['csrf'],
                'flow_id' => $pending['flow_id'], 'claim' => null];
            if (!session_write_close()) { throw nas_error('NAS_UNREACHABLE'); }
            $result = $client->approvalStatus($pending);
            if (!nas_resume_approval($config, $approvalContext)) { $client->cancelApproval($pending); throw nas_error('APPROVAL_EXPIRED'); }
            if (time() >= (int)$_SESSION['approval']['deadline']) { nas_cancel_pending($config, $transport); throw nas_error('APPROVAL_EXPIRED'); }
            $_SESSION['last_seen'] = time();
            if (($result['state'] ?? null) === 'pending' || ($_SESSION['approval']['claim'] ?? null) !== null) {
                nas_json(nas_approval_reply($config, $_SESSION['approval']));
            }
            // A short locked claim ensures concurrent approved polls redeem once.
            $approvalContext['claim'] = bin2hex(random_bytes(16));
            $_SESSION['approval']['claim'] = $approvalContext['claim'];
            if (!session_write_close()) { throw nas_error('NAS_UNREACHABLE'); }
            $client->finishApproval($pending, $result['token']);
            if (!nas_resume_approval($config, $approvalContext, true)) { $client->logout(); throw nas_error('APPROVAL_EXPIRED'); }
            if (time() >= (int)$_SESSION['approval']['deadline']) {
                $client->logout(); nas_cancel_pending($config, $transport); throw nas_error('APPROVAL_EXPIRED');
            }
            if (!session_regenerate_id(true)) { $client->logout(); nas_cancel_pending($config, $transport); throw nas_error('NAS_UNREACHABLE'); }
            unset($_SESSION['approval']);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            $_SESSION['created_at'] = $_SESSION['last_seen'] = time();
            $_SESSION['dsm'] = $client->authenticationState();
            nas_json(nas_status($config, true));
        }
        if ($action === 'login') {
            if (isset($_SESSION['dsm'])) { throw nas_error('INVALID_REQUEST'); }
            $username = $input['username'] ?? null;
            $password = $input['password'] ?? null;
            $otp = $input['otp'] ?? null;
            $authMode = $input['authMode'] ?? 'otp';
            if (!is_string($username) || $username === '' || strlen($username) > 256 || preg_match('//u', $username) !== 1
                || preg_match('/\p{Cc}/u', $username) === 1 || !is_string($password) || $password === '' || strlen($password) > 4096
                || !in_array($authMode, ['otp', 'approval'], true)
                || ($otp !== null && (!is_string($otp) || ($otp !== '' && preg_match('/^[0-9]{6}$/D', $otp) !== 1)))) {
                throw nas_error('INVALID_REQUEST');
            }
            nas_cancel_pending($config, $transport);
            try {
                if ($authMode === 'approval') {
                    $rate->beginApproval();
                    $pending = $client->loginApproval($username, $password);
                    $pending['flow_id'] = bin2hex(random_bytes(16));
                    $pending['deadline'] = time() + (int)($config['approval_ttl'] ?? 120);
                    $pending['next_poll'] = time() + (int)($config['approval_poll_interval'] ?? 5);
                    $pending['claim'] = null;
                    $_SESSION['approval'] = $pending;
                } else { $client->login($username, $password, $otp); }
            }
            catch (GatewayError $error) {
                if (in_array($error->errorCode, ['AUTH_FAILED', 'OTP_INVALID', 'FORBIDDEN'], true)) { $rate->failedLogin(); }
                throw $error;
            } finally { unset($input['password'], $input['otp'], $password, $otp); }
            if ($authMode === 'approval') {
                $rate->close(); $rate = null;
                nas_json(nas_approval_reply($config, $_SESSION['approval']));
            }
            if (!session_regenerate_id(true)) { $client->logout(); throw nas_error('NAS_UNREACHABLE'); }
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            $_SESSION['created_at'] = $_SESSION['last_seen'] = time();
            $_SESSION['dsm'] = $client->authenticationState();
            $rate->close(); $rate = null;
            nas_json(nas_status($config, true));
        }
        if (!is_array($_SESSION['dsm'] ?? null)) { throw nas_error(isset($_SESSION['approval']) ? 'FORBIDDEN' : 'SESSION_EXPIRED'); }
        $client->restoreAuthentication($_SESSION['dsm']);
        if ($action === 'list') {
            $path = SynologyClient::validatePath($input['path'] ?? '/');
            $offset = $input['offset'] ?? 0;
            $limit = $input['limit'] ?? 100;
            if (!is_int($offset) || $offset < 0 || $offset > 10000000 || !is_int($limit) || $limit < 1 || $limit > 100) { throw nas_error('INVALID_REQUEST'); }
            $listing = $client->listEntries($path, $offset, $limit);
            $_SESSION['last_seen'] = time();
            $listing['expiresIn'] = nas_expiry($config, $_SESSION);
            nas_json($listing);
        }
        if ($action === 'download') {
            $path = SynologyClient::validatePath($input['path'] ?? null, false);
            $downloadContext = ['id' => session_id(), 'origin' => $_SESSION['origin'], 'csrf' => $_SESSION['csrf'],
                'sid' => $_SESSION['dsm']['sid'], 'created_at' => $_SESSION['created_at'], 'last_seen' => $_SESSION['last_seen']];
            // The authenticated client owns a copy of the DSM credentials. Release
            // the PHP lock before getinfo/download so status and logout can proceed.
            if (!session_write_close()) { throw nas_error('NAS_UNREACHABLE'); }
            $download = $client->download($path);
            header('Content-Type: application/octet-stream');
            header("Content-Disposition: attachment; filename=\"download.txt\"; filename*=UTF-8''" . rawurlencode(basename($path)));
            header('X-Textview-Filename: ' . rawurlencode(basename($path)));
            header('X-Textview-Session-Expires-In: ' . nas_expiry($config, $downloadContext));
            header('Content-Length: ' . $download->bytes);
            $download->output();
            return;
        }
        throw nas_error('INVALID_REQUEST');
    } catch (GatewayError $error) {
        if (in_array($error->errorCode, ['APPROVAL_DENIED', 'APPROVAL_EXPIRED', 'APPROVAL_UNAVAILABLE', 'SESSION_EXPIRED'], true)
            && $approvalContext !== null) {
            try {
                $matching = session_status() === PHP_SESSION_ACTIVE || nas_resume_approval($config, $approvalContext);
                if ($matching && ($_SESSION['approval']['flow_id'] ?? null) === $approvalContext['flow_id']
                    && ($_SESSION['approval']['claim'] ?? null) === $approvalContext['claim']) { nas_cancel_pending($config, $transport); }
            } catch (Throwable) {}
            if ($error->errorCode === 'SESSION_EXPIRED') {
                $mapped = nas_error('APPROVAL_EXPIRED');
                $error = new GatewayError($mapped->errorCode, $mapped->httpStatus, $mapped->getMessage(), $error->diagnostic);
            }
        }
        if ($error->errorCode === 'SESSION_EXPIRED') {
            if ($downloadContext !== null) { nas_invalidate_download_session($config, $downloadContext, $transport); }
            elseif (session_status() === PHP_SESSION_ACTIVE) { nas_destroy_session($config, $transport); }
        }
        if ($rate instanceof NasRateBucket) {
            try { $rate->close(); } catch (Throwable) { $error = nas_error('NAS_UNREACHABLE'); }
            $rate = null;
        }
        if ($error->httpStatus === 429) { header('Retry-After: ' . (int)$config['rate_window']); }
        if (!headers_sent()) {
            $details = ['code' => $error->errorCode, 'message' => $error->getMessage()];
            $diagnostic = nas_safe_approval_diagnostic($error->diagnostic);
            if ($diagnostic !== null) { $details['diagnostic'] = $diagnostic; }
            nas_json(['ok' => false, 'error' => $details], $error->httpStatus);
        }
    } catch (Throwable) {
        if ($rate instanceof NasRateBucket) { try { $rate->close(); } catch (Throwable) {} $rate = null; }
        if (!headers_sent()) { nas_json(['ok' => false, 'error' => ['code' => 'NAS_UNREACHABLE', 'message' => 'NAS 연결을 처리하지 못했습니다. 서버 설정을 확인하세요.']], 502); }
    } finally {
        if ($download instanceof SynologyResponse) { $download->close(); }
        if ($rate instanceof NasRateBucket) { try { $rate->close(); } catch (Throwable) {} }
        restore_error_handler();
    }
}

if (!defined('TEXTVIEW_NAS_LIBRARY_ONLY')) { nas_run(); }
