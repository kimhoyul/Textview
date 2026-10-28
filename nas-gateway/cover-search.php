<?php
declare(strict_types=1);

require_once __DIR__ . '/novelpia.php';

function nas_cover_available(): bool
{
    return extension_loaded('curl') && class_exists(DOMDocument::class);
}

function nas_cover_error(string $code = 'COVER_UNAVAILABLE'): GatewayError
{
    return match ($code) {
        'COVER_TOKEN_EXPIRED' => new GatewayError($code, 403, '표지 선택 시간이 지났습니다. 다시 검색해 주세요.'),
        'COVER_INVALID_QUERY' => new GatewayError($code, 400, '작품 이름을 100자 이내로 입력해 주세요.'),
        default => new GatewayError('COVER_UNAVAILABLE', 502, '표지 검색에 연결하지 못했습니다. 잠시 후 다시 검색해 주세요.'),
    };
}

function nas_cover_url(string $url, bool $search = false): string
{
    $parts = parse_url($url);
    $host = $search ? 'series.naver.com' : 'comicthumb-phinf.pstatic.net';
    if (strlen($url) > 4096 || preg_match('/[\x00-\x20\x7f]/', $url) === 1 || !is_array($parts)
        || ($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') !== $host
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
        || (isset($parts['port']) && $parts['port'] !== 443)
        || ($search && ($parts['path'] ?? '') !== '/search/search.series')) {
        throw nas_cover_error();
    }
    return $url;
}

/** URLs are built by this helper; request data cannot supply a fetch destination. */
function nas_cover_fetch(string $url, int $maximum, bool $search = false): array
{
    nas_cover_url($url, $search);
    $handle = curl_init($url);
    if ($handle === false) { throw nas_cover_error(); }
    $body = '';
    $tooLarge = false;
    try {
        curl_setopt_array($handle, [
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
            CURLOPT_USERAGENT => 'Mozilla/5.0 HoyulSeries-Cover/1.0',
            CURLOPT_HTTPHEADER => ['Accept: ' . ($search ? 'text/html' : 'image/jpeg,image/png,image/webp')],
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge, $maximum): int {
                if (strlen($body) + strlen($chunk) > $maximum) { $tooLarge = true; return 0; }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        if (curl_exec($handle) === false || $tooLarge || (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE) !== 200) { throw nas_cover_error(); }
        return ['body' => $body, 'type' => strtolower(trim(explode(';', (string)curl_getinfo($handle, CURLINFO_CONTENT_TYPE))[0]))];
    } finally { curl_close($handle); }
}

function nas_cover_parse(string $html): array
{
    if (strlen($html) > 2 * 1024 * 1024 || !class_exists(DOMDocument::class)) { throw nas_cover_error(); }
    $previous = libxml_use_internal_errors(true);
    try {
        $document = new DOMDocument();
        if (!$document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) { throw nas_cover_error(); }
        $xpath = new DOMXPath($document);
        $links = $xpath->query('//ul[contains(concat(" ", normalize-space(@class), " "), " lst_list ")]//h3/a');
        $results = [];
        $seen = [];
        foreach ($links ?: [] as $link) {
            if (!$link instanceof DOMElement || preg_match('~^/(?:novel|ebook)/detail\.series\?productNo=([0-9]{1,12})$~D', $link->getAttribute('href'), $match) !== 1 || isset($seen[$match[1]])) { continue; }
            $row = $link;
            while ($row->parentNode !== null && strtolower($row->nodeName) !== 'li') { $row = $row->parentNode; }
            $image = $xpath->query('.//img[@src]', $row)?->item(0);
            if (!$image instanceof DOMElement) { continue; }
            $url = html_entity_decode($image->getAttribute('src'), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            try { nas_cover_url($url); } catch (GatewayError) { continue; }
            $title = trim($image->getAttribute('alt'));
            if ($title === '') { $title = trim((string)preg_replace('/\s*\(총.*$/us', '', $link->textContent)); }
            if ($title === '' || strlen($title) > 600) { continue; }
            $author = trim($xpath->query('.//span[contains(concat(" ", normalize-space(@class), " "), " author ")]', $row)?->item(0)?->textContent ?? '');
            $thumbnailUrl = (string)preg_replace('/([?&]type=)m79(?=&|$)/', '$1m260', $url);
            $downloadUrl = rtrim((string)preg_replace('/([?&])type=[^&#]*&?/', '$1', $url), '?&');
            $results[] = ['id' => 'series:' . $match[1], 'title' => $title, 'author' => $author,
                'thumbnailUrl' => $thumbnailUrl, 'sourceName' => '네이버 시리즈', 'url' => nas_cover_url($downloadUrl)];
            $seen[$match[1]] = true;
            if (count($results) >= 12) { break; }
        }
        if ($results === [] && preg_match('/검색\s*결과가\s*없|검색된\s*(?:작품|결과)가\s*없|검색\s*결과\s*없/', $html) !== 1) { throw nas_cover_error(); }
        return $results;
    } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
}

/** The optional fetcher is reachable only from server-side tests. */
function nas_cover_search(mixed $query, array &$session, ?callable $fetcher = null, ?callable $novelpiaFetcher = null): array
{
    if (!is_string($query) || preg_match('//u', $query) !== 1) { throw nas_cover_error('COVER_INVALID_QUERY'); }
    $query = trim($query);
    if (preg_match('/^.{1,100}$/usD', $query) !== 1 || preg_match('/\p{Cc}/u', $query) === 1) { throw nas_cover_error('COVER_INVALID_QUERY'); }
    $now = time();
    // Legacy test fetchers describe Series only. A separate fixture opts into
    // Novelpia tests without accidentally reaching the public network.
    $includeNovelpia = $fetcher === null || $novelpiaFetcher !== null;
    $providers = $includeNovelpia ? 'series+novelpia:v1' : 'series:v1';
    $cached = $session['cover_cache'] ?? null;
    if (is_array($cached) && ($cached['query'] ?? '') === $query && ($cached['providers'] ?? '') === $providers
        && (int)($cached['time'] ?? 0) > $now - 60) { return $cached['results']; }
    $url = 'https://series.naver.com/search/search.series?t=all&fs=novel&q=' . rawurlencode($query);
    $rows = [];
    $failed = false;
    try {
        $response = $fetcher ? $fetcher($url, 2 * 1024 * 1024, true) : nas_cover_fetch($url, 2 * 1024 * 1024, true);
        if (($response['type'] ?? '') !== 'text/html') { throw nas_cover_error(); }
        $rows = nas_cover_parse($response['body'] ?? '');
    } catch (GatewayError $error) {
        if (!$includeNovelpia) { throw $error; }
        $failed = true;
    }
    if ($includeNovelpia) {
        try { $rows = array_merge($rows, nas_novelpia_search($query, $novelpiaFetcher)); }
        catch (GatewayError) { $failed = true; }
    }
    if ($rows === [] && $failed) { throw nas_cover_error(); }
    $tokens = [];
    $results = [];
    foreach ($rows as $row) {
        $token = bin2hex(random_bytes(24));
        $tokens[$token] = ['url' => $row['url'], 'provider' => str_starts_with($row['id'], 'novelpia:') ? 'novelpia' : 'series', 'expires' => $now + 300];
        unset($row['url']);
        $row['token'] = $token;
        $results[] = $row;
    }
    $session['cover_candidates'] = $tokens;
    $session['cover_cache'] = ['query' => $query, 'providers' => $providers, 'time' => $now, 'results' => $results];
    return $results;
}

function nas_cover_raster(string $body, string $contentType): string
{
    if ($body === '' || strlen($body) > 5 * 1024 * 1024) { throw nas_cover_error(); }
    $mime = str_starts_with($body, "\xff\xd8\xff") ? 'image/jpeg'
        : (str_starts_with($body, "\x89PNG\r\n\x1a\n") ? 'image/png'
        : (substr($body, 0, 4) === 'RIFF' && substr($body, 8, 4) === 'WEBP' ? 'image/webp' : ''));
    $info = $mime !== '' ? @getimagesizefromstring($body) : false;
    if ($mime === '' || $contentType !== $mime || !is_array($info) || ($info['mime'] ?? '') !== $mime
        || $info[0] < 1 || $info[1] < 1 || $info[0] * $info[1] > 60 * 1000 * 1000) { throw nas_cover_error(); }
    return $mime;
}

function nas_cover_download(mixed $token, array $session, ?callable $fetcher = null): array
{
    if (!is_string($token) || preg_match('/^[a-f0-9]{48}$/D', $token) !== 1) { throw nas_cover_error('COVER_TOKEN_EXPIRED'); }
    $candidate = $session['cover_candidates'][$token] ?? null;
    if (!is_array($candidate) || (int)($candidate['expires'] ?? 0) <= time() || !is_string($candidate['url'] ?? null)) { throw nas_cover_error('COVER_TOKEN_EXPIRED'); }
    $provider = $candidate['provider'] ?? 'series';
    if (!in_array($provider, ['series', 'novelpia'], true)) { throw nas_cover_error('COVER_TOKEN_EXPIRED'); }
    if ($provider === 'novelpia') {
        $response = nas_novelpia_cover_download(nas_novelpia_image_url($candidate['url']), $fetcher);
    } else {
        $url = nas_cover_url($candidate['url']);
        $response = $fetcher ? $fetcher($url, 5 * 1024 * 1024, false) : nas_cover_fetch($url, 5 * 1024 * 1024, false);
    }
    $response['type'] = nas_cover_raster($response['body'] ?? '', $response['type'] ?? '');
    return $response;
}
