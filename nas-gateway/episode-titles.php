<?php
declare(strict_types=1);

function nas_episode_available(): bool
{
    return extension_loaded('curl');
}

function nas_episode_error(string $code = 'EPISODE_UNAVAILABLE'): GatewayError
{
    return match ($code) {
        'EPISODE_INVALID_REQUEST' => new GatewayError($code, 400, '회차 제목 요청을 확인해 주세요.'),
        'EPISODE_NOT_FOUND' => new GatewayError($code, 404, '이 작품의 공개 회차 목록을 찾지 못했습니다.'),
        default => new GatewayError('EPISODE_UNAVAILABLE', 502, '회차 제목을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    };
}

function nas_episode_arguments(mixed $productId, mixed $page): array
{
    if (!is_string($productId) || preg_match('/^[1-9][0-9]{0,11}$/D', $productId) !== 1
        || !is_int($page) || $page < 1 || $page > 334) {
        throw nas_episode_error('EPISODE_INVALID_REQUEST');
    }
    return [$productId, $page];
}

/** Public metadata only. Request input cannot provide a host, path, or URL. */
function nas_episode_list_url(mixed $productId, mixed $page): string
{
    [$productId, $page] = nas_episode_arguments($productId, $page);
    return 'https://series.naver.com/novel/volumeList.series?productNo=' . $productId . '&sortOrder=ASC&page=' . $page;
}

function nas_episode_fetch(string $url): array
{
    if (preg_match('~^https://series\.naver\.com/novel/volumeList\.series\?productNo=[1-9][0-9]{0,11}&sortOrder=ASC&page=([1-9][0-9]{0,2})$~D', $url, $match) !== 1
        || (int)$match[1] > 334) { throw nas_episode_error('EPISODE_INVALID_REQUEST'); }
    $handle = curl_init($url);
    if ($handle === false) { throw nas_episode_error(); }
    $body = '';
    $tooLarge = false;
    try {
        curl_setopt_array($handle, [
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
            CURLOPT_USERAGENT => 'Mozilla/5.0 HoyulSeries-Episodes/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge): int {
                if (strlen($body) + strlen($chunk) > 2 * 1024 * 1024) { $tooLarge = true; return 0; }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        if (curl_exec($handle) === false || $tooLarge || (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE) !== 200) { throw nas_episode_error(); }
        return ['body' => $body, 'type' => strtolower(trim(explode(';', (string)curl_getinfo($handle, CURLINFO_CONTENT_TYPE))[0]))];
    } finally { curl_close($handle); }
}

/** Reject malformed metadata rather than silently assigning a different episode. */
function nas_episode_text(mixed $value, bool $empty = false): string
{
    if (!is_string($value) || preg_match('//u', $value) !== 1 || preg_match('/\p{Cc}/u', $value) === 1) { throw nas_episode_error(); }
    $value = trim($value);
    if (($value === '' && !$empty) || preg_match('/^.{0,300}$/usD', $value) !== 1) { throw nas_episode_error(); }
    return $value;
}

function nas_episode_parse(string $body, string $productId, int $page): array
{
    if (strlen($body) > 2 * 1024 * 1024) { throw nas_episode_error(); }
    try { $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw nas_episode_error(); }
    $rows = is_array($data) ? ($data['resultData'] ?? null) : null;
    if (!is_array($rows) || !array_is_list($rows) || count($rows) > 30) { throw nas_episode_error(); }
    if ($rows === []) { throw nas_episode_error('EPISODE_NOT_FOUND'); }
    $title = null;
    $author = null;
    $total = null;
    $lastNumber = 0;
    $episodes = [];
    foreach ($rows as $row) {
        if (!is_array($row) || !is_int($row['volumeNo'] ?? null) || $row['volumeNo'] < 1 || $row['volumeNo'] > 10000
            || $row['volumeNo'] <= $lastNumber || ($row['volumeType'] ?? null) !== '화'
            || $row['volumeNo'] <= ($page - 1) * 30 || $row['volumeNo'] > $page * 30
            || !is_int($row['totalVolumeCount'] ?? null) || $row['totalVolumeCount'] < 1 || $row['totalVolumeCount'] > 10000
            || $row['volumeNo'] > $row['totalVolumeCount']) { throw nas_episode_error(); }
        $rowTitle = nas_episode_text($row['productName'] ?? null);
        $rowAuthor = nas_episode_text($row['writingAuthorName'] ?? $row['authorNames'] ?? '', true);
        if ($title !== null && ($rowTitle !== $title || $rowAuthor !== $author || $row['totalVolumeCount'] !== $total)) { throw nas_episode_error(); }
        $title = $rowTitle;
        $author = $rowAuthor;
        $total = $row['totalVolumeCount'];
        $lastNumber = $row['volumeNo'];
        $subtitle = nas_episode_text($row['subProductName'] ?? '', true);
        if ($subtitle !== '') { $episodes[] = ['number' => $row['volumeNo'], 'title' => $subtitle]; }
    }
    return ['productId' => $productId, 'page' => $page, 'title' => $title, 'author' => $author,
        'total' => $total, 'hasMore' => $page < 334 && $page * 30 < $total, 'episodes' => $episodes];
}

/** The optional fetcher is for local server tests, never request data. */
function nas_episode_titles(mixed $productId, mixed $page, array &$session, ?callable $fetcher = null): array
{
    [$productId, $page] = nas_episode_arguments($productId, $page);
    $url = nas_episode_list_url($productId, $page);
    $now = time();
    $key = $productId . ':' . $page;
    $cache = is_array($session['episode_cache'] ?? null) ? $session['episode_cache'] : [];
    $cache = array_filter($cache, static fn($item): bool => is_array($item) && is_int($item['time'] ?? null)
        && $item['time'] > $now - 60 && is_array($item['result'] ?? null));
    $cache = array_slice($cache, -6, null, true);
    if (isset($cache[$key])) { return $cache[$key]['result']; }
    $response = $fetcher ? $fetcher($url) : nas_episode_fetch($url);
    if (!is_array($response) || ($response['type'] ?? '') !== 'application/json' || !is_string($response['body'] ?? null)) { throw nas_episode_error(); }
    $result = nas_episode_parse($response['body'], $productId, $page);
    $cache[$key] = ['time' => $now, 'result' => $result];
    $session['episode_cache'] = array_slice($cache, -6, null, true);
    return $result;
}
