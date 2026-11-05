<?php
declare(strict_types=1);

/** Binary upload request: authenticated caller, UTF-8 path headers, streamed private staging. */
function nas_upload_field(string $header, int $maximum): string
{
    $raw = nas_request_header($header);
    if ($raw === '' || strlen($raw) > $maximum * 3 || preg_match('/[^\\x21-\\x7e]/D', $raw) === 1
        || preg_match('/%(?![0-9A-Fa-f]{2})/', $raw) === 1) { throw nas_error('INVALID_REQUEST'); }
    $decoded = rawurldecode($raw);
    if (strlen($decoded) > $maximum || preg_match('//u', $decoded) !== 1
        || preg_match('/\\p{Cc}/u', $decoded) === 1) { throw nas_error('INVALID_REQUEST'); }
    return $decoded;
}

function nas_upload_missing_txt(SynologyClient $client, array $config): array
{
    $folder = nas_upload_field('X-Textview-Upload-Folder', 2048);
    $book = nas_upload_field('X-Textview-Upload-Book', 300);
    $name = nas_upload_field('X-Textview-Upload-Name', 240);
    $checksum = nas_request_header('X-Textview-Upload-Sha256');
    $declared = nas_request_header('X-Textview-Upload-Size');
    if (preg_match('/^[a-f0-9]{64}$/D', $checksum) !== 1
        || preg_match('/^(0|[1-9][0-9]{0,8})$/D', $declared) !== 1
        || (int)$declared > 32 * 1024 * 1024) { throw nas_error('INVALID_REQUEST'); }
    $length = nas_request_header('Content-Length');
    if ($length !== '' && (preg_match('/^(0|[1-9][0-9]{0,8})$/D', $length) !== 1
        || (int)$length !== (int)$declared)) { throw nas_error('INVALID_REQUEST'); }
    $path = tempnam($config['runtime_dir'] . '/buffers', 'upload-');
    if ($path === false || is_link($path) || !chmod($path, 0600)) { throw nas_error('NAS_UNREACHABLE'); }
    $source = null;
    $target = null;
    try {
        $source = fopen('php://input', 'rb');
        $target = fopen($path, 'wb');
        if ($source === false || $target === false) { throw nas_error('NAS_UNREACHABLE'); }
        $sha = hash_init('sha256');
        $received = 0;
        while (!feof($source)) {
            $chunk = fread($source, 65536);
            if ($chunk === false || ($chunk === '' && !feof($source))) { throw nas_error('NAS_UNREACHABLE'); }
            if ($chunk === '') { break; }
            $received += strlen($chunk);
            if ($received > 32 * 1024 * 1024 || $received > (int)$declared) { throw nas_error('INVALID_REQUEST'); }
            hash_update($sha, $chunk);
            $written = 0;
            while ($written < strlen($chunk)) {
                $n = fwrite($target, substr($chunk, $written));
                if ($n === false || $n === 0) { throw nas_error('NAS_UNREACHABLE'); }
                $written += $n;
            }
        }
        if ($received !== (int)$declared || !hash_equals($checksum, hash_final($sha)) || !fflush($target)) {
            throw nas_error('INVALID_REQUEST');
        }
        fclose($source); $source = null;
        fclose($target); $target = null;
        $result = $client->uploadMissingTxt($folder, $book, $name, $path, $received);
        return ['ok' => true, 'folder' => $folder] + $result;
    } finally {
        if (is_resource($source)) { fclose($source); }
        if (is_resource($target)) { fclose($target); }
        @unlink($path);
    }
}
