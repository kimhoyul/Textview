<?php
declare(strict_types=1);

// Server configuration only. Never put an account, password, OTP, or SID here.
return [
    'dsm_url' => 'https://chhc007.synology.me:9999',
    'allowed_origins' => [
        'https://kimhoyul.github.io',
    ],
    'require_https' => true,
    'allow_loopback_http_for_tests' => false,
    'runtime_dir' => rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'textview-nas-' . substr(hash('sha256', __DIR__), 0, 16),
    'idle_ttl' => 900,
    'absolute_ttl' => 7200,
    'max_download_bytes' => 32 * 1024 * 1024,
    'max_json_bytes' => 2 * 1024 * 1024,
    'max_request_bytes' => 16 * 1024,
    'connect_timeout' => 5,
    'api_timeout' => 20,
    'download_timeout' => 120,
    'logout_timeout' => 2,
    'rate_window' => 600,
    'max_login_failures' => 5,
    'max_approvals' => 5,
    'approval_ttl' => 120,
    'approval_poll_interval' => 5,
    'gateway_version' => 'nas4',
    'max_bootstraps' => 20,
    'max_requests' => 300,
    'max_sessions' => 1024,
    'max_rate_files' => 2048,
    'ca_file' => null, // Optional trusted CA PEM; TLS verification stays enabled.
];
