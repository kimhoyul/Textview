<?php
declare(strict_types=1);

/** Novelpia's public catalogue and numbered episode headings only. Never fetch a viewer. */
function nas_novelpia_image_url(string $url): string
{
    $parts = parse_url($url);
    if (strlen($url) > 1024 || preg_match('/[\x00-\x20\x7f]/', $url) === 1 || !is_array($parts)
        || ($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') !== 'images.novelpia.com'
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        || (isset($parts['port']) && $parts['port'] !== 443)
        || preg_match('~^/imagebox/cover/[a-zA-Z0-9_-]{1,180}\.(?:file|wimg|jpe?g|png|webp)$~D', $parts['path'] ?? '') !== 1) {
        throw nas_cover_error();
    }
    return $url;
}

function nas_novelpia_public_url(string $url, string $kind, ?array $postData = null): string
{
    if ($kind === 'image') { return nas_novelpia_image_url($url); }
    $parts = parse_url($url);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') !== 'novelpia.com'
        || strlen($url) > 2048 || preg_match('/[\x00-\x20\x7f]/', $url) === 1
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
        || (isset($parts['port']) && $parts['port'] !== 443)) { throw nas_episode_error(); }
    if ($kind === 'detail' && preg_match('~^/novel/[1-9][0-9]{0,11}$~D', $parts['path'] ?? '') === 1
        && !isset($parts['query']) && $postData === null) { return $url; }
    if ($kind === 'search' && ($parts['path'] ?? '') === '/proc/novel' && $postData === null) {
        parse_str($parts['query'] ?? '', $query);
        if (array_keys($query) === ['cmd', 'page', 'rows', 'search_type', 'search_val']
            && $query['cmd'] === 'novel_search' && $query['page'] === '1' && $query['rows'] === '12'
            && $query['search_type'] === 'novel_name' && is_string($query['search_val'])
            && preg_match('/^.{1,100}$/usD', $query['search_val']) === 1
            && preg_match('/\p{Cc}/u', $query['search_val']) !== 1) { return $url; }
    }
    if ($kind === 'episodes' && ($parts['path'] ?? '') === '/proc/episode_list' && !isset($parts['query'])
        && is_array($postData) && array_keys($postData) === ['novel_no', 'sort', 'page']
        && is_string($postData['novel_no']) && preg_match('/^[1-9][0-9]{0,11}$/D', $postData['novel_no']) === 1
        && $postData['sort'] === 'DOWN' && is_int($postData['page']) && $postData['page'] >= 0 && $postData['page'] <= 1000) { return $url; }
    throw nas_episode_error();
}

/** The optional fetcher is a server-test seam; HTTP clients cannot choose destinations. */
function nas_novelpia_fetch(string $url, int $maximum, string $kind, ?array $postData = null, ?float $deadline = null): array
{
    nas_novelpia_public_url($url, $kind, $postData);
    $handle = curl_init($url);
    if ($handle === false) { throw nas_episode_error(); }
    $body = '';
    $tooLarge = false;
    $budget = $deadline === null ? 5000 : min(5000, (int)floor(($deadline - microtime(true)) * 1000));
    if ($budget < 1) { curl_close($handle); throw nas_episode_error(); }
    try {
        curl_setopt_array($handle, [
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT_MS => min(3000, $budget), CURLOPT_TIMEOUT_MS => $budget,
            CURLOPT_USERAGENT => 'Mozilla/5.0 HoyulSeries-Metadata/1.0',
            CURLOPT_HTTPHEADER => ['Accept: ' . ($kind === 'search' ? 'application/json' : ($kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'text/html'))],
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge, $maximum): int {
                if (strlen($body) + strlen($chunk) > $maximum) { $tooLarge = true; return 0; }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        if ($postData !== null) {
            curl_setopt($handle, CURLOPT_POST, true);
            curl_setopt($handle, CURLOPT_POSTFIELDS, http_build_query($postData, '', '&', PHP_QUERY_RFC3986));
        }
        if (curl_exec($handle) === false || $tooLarge || (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE) !== 200) { throw nas_episode_error(); }
        return ['body' => $body, 'type' => strtolower(trim(explode(';', (string)curl_getinfo($handle, CURLINFO_CONTENT_TYPE))[0]))];
    } finally { curl_close($handle); }
}

function nas_novelpia_response(string $url, int $maximum, string $kind, ?array $postData, ?callable $fetcher, ?float $deadline = null): array
{
    nas_novelpia_public_url($url, $kind, $postData);
    if ($deadline !== null && microtime(true) >= $deadline) { throw nas_episode_error(); }
    $response = $fetcher ? $fetcher($url, $maximum, $kind, $postData) : nas_novelpia_fetch($url, $maximum, $kind, $postData, $deadline);
    if (!is_array($response) || !is_string($response['body'] ?? null) || !is_string($response['type'] ?? null)
        || $response['body'] === '' || strlen($response['body']) > $maximum
        || ($deadline !== null && microtime(true) >= $deadline)) { throw nas_episode_error(); }
    return $response;
}

function nas_novelpia_image_candidate(mixed $value): string
{
    if (!is_string($value)) { throw nas_cover_error(); }
    if (str_starts_with($value, '//images.novelpia.com/')) { $value = 'https:' . $value; }
    elseif (str_starts_with($value, '/imagebox/cover/')) { $value = 'https://images.novelpia.com' . $value; }
    return nas_novelpia_image_url($value);
}

function nas_novelpia_search(mixed $query, ?callable $fetcher = null): array
{
    if (!is_string($query) || preg_match('//u', $query) !== 1) { throw nas_cover_error('COVER_INVALID_QUERY'); }
    $query = trim($query);
    if (preg_match('/^.{1,100}$/usD', $query) !== 1 || preg_match('/\p{Cc}/u', $query) === 1) { throw nas_cover_error('COVER_INVALID_QUERY'); }
    $url = 'https://novelpia.com/proc/novel?' . http_build_query(['cmd' => 'novel_search', 'page' => 1, 'rows' => 12,
        'search_type' => 'novel_name', 'search_val' => $query], '', '&', PHP_QUERY_RFC3986);
    $response = nas_novelpia_response($url, 2 * 1024 * 1024, 'search', null, $fetcher);
    if ($response['type'] !== 'application/json') { throw nas_cover_error(); }
    try { $data = json_decode($response['body'], true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw nas_cover_error(); }
    if (!is_array($data) || ($data['status'] ?? null) !== 200 || !is_array($data['list'] ?? null)
        || !array_is_list($data['list']) || count($data['list']) > 12) { throw nas_cover_error(); }
    $results = [];
    $seen = [];
    foreach ($data['list'] as $row) {
        if (!is_array($row) || (!is_int($row['novel_no'] ?? null) && !is_string($row['novel_no'] ?? null))) { continue; }
        $id = (string)$row['novel_no'];
        if (preg_match('/^[1-9][0-9]{0,11}$/D', $id) !== 1 || isset($seen[$id])) { continue; }
        try {
            $title = nas_episode_text($row['novel_name'] ?? null);
            $author = nas_episode_text($row['writer_nick'] ?? '', true);
            $cover = nas_novelpia_image_candidate(($row['novel_img_all'] ?? null) ?: ($row['novel_thumb_all'] ?? $row['cover_url'] ?? null));
            $thumbnail = nas_novelpia_image_candidate($row['cover_url'] ?? $row['novel_thumb_all'] ?? $cover);
        } catch (GatewayError) { continue; }
        $results[] = ['id' => 'novelpia:' . $id, 'title' => $title, 'author' => $author,
            'thumbnailUrl' => $thumbnail, 'sourceName' => '노벨피아', 'url' => $cover];
        $seen[$id] = true;
    }
    return $results;
}

function nas_novelpia_cover_download(string $url, ?callable $fetcher = null): array
{
    $response = nas_novelpia_response(nas_novelpia_image_url($url), 5 * 1024 * 1024, 'image', null, $fetcher);
    $body = $response['body'];
    $mime = str_starts_with($body, "\xff\xd8\xff") ? 'image/jpeg'
        : (str_starts_with($body, "\x89PNG\r\n\x1a\n") ? 'image/png'
        : (substr($body, 0, 4) === 'RIFF' && substr($body, 8, 4) === 'WEBP' ? 'image/webp' : ''));
    $size = $mime !== '' ? @getimagesizefromstring($body) : false;
    if ($mime === '' || !is_array($size) || ($size['mime'] ?? '') !== $mime || $size[0] < 1 || $size[1] < 1
        || $size[0] * $size[1] > 60 * 1000 * 1000
        || !in_array($response['type'], ['', 'application/octet-stream', 'binary/octet-stream', $mime], true)) { throw nas_cover_error(); }
    return ['body' => $body, 'type' => $mime];
}

function nas_novelpia_document(string $html): DOMDocument
{
    if (!class_exists(DOMDocument::class) || strlen($html) > 2 * 1024 * 1024 || preg_match('//u', $html) !== 1) { throw nas_episode_error(); }
    $document = new DOMDocument();
    if (!$document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) { throw nas_episode_error(); }
    return $document;
}

function nas_novelpia_detail(string $productId, array &$session, ?callable $fetcher, ?float $deadline = null): array
{
    $key = 'detail:' . $productId;
    $cached = $session['novelpia_metadata_cache'][$key] ?? null;
    if (is_array($cached) && ($cached['time'] ?? 0) > time() - 60) { return $cached['value']; }
    $response = nas_novelpia_response('https://novelpia.com/novel/' . $productId, 2 * 1024 * 1024, 'detail', null, $fetcher, $deadline);
    if ($response['type'] !== 'text/html') { throw nas_episode_error(); }
    $previous = libxml_use_internal_errors(true);
    try {
        $xpath = new DOMXPath(nas_novelpia_document($response['body']));
        $title = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " epnew-novel-title ")]')?->item(0)?->textContent;
        $author = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " epnew-writer ")]//*[contains(concat(" ", normalize-space(@class), " "), " writer-name ")]')?->item(0)?->textContent;
        if ($title === null || $author === null) { throw nas_episode_error('EPISODE_NOT_FOUND'); }
        $total = null;
        foreach ($xpath->query('//span') ?: [] as $node) {
            if (preg_match('/^([1-9][0-9]{0,4})\s*회차$/uD', trim($node->textContent), $match) !== 1) { continue; }
            if ((int)$match[1] > 10000 || ($total !== null && $total !== (int)$match[1])) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
            $total = (int)$match[1];
        }
        if ($total === null) { throw nas_episode_error('EPISODE_NOT_FOUND'); }
        $value = ['title' => nas_episode_text(trim($title)), 'author' => nas_episode_text(trim($author), true), 'total' => $total];
    } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
    $cache = is_array($session['novelpia_metadata_cache'] ?? null) ? $session['novelpia_metadata_cache'] : [];
    $cache[$key] = ['time' => time(), 'value' => $value];
    $session['novelpia_metadata_cache'] = array_slice($cache, -20, null, true);
    return $value;
}

/** Use official EP labels. BONUS and notices never acquire an invented file number. */
function nas_novelpia_parse_episodes(string $html, string $productId, int $index): array
{
    $previous = libxml_use_internal_errors(true);
    try {
        $xpath = new DOMXPath(nas_novelpia_document($html));
        $table = $xpath->query('//table[@id="episode_table"]')?->item(0);
        if (!$table) { throw nas_episode_error('EPISODE_NOT_FOUND'); }
        $rows = $xpath->query('.//tr[@data-episode-no]', $table);
        if ($rows === false || count($rows) < 1 || count($rows) > 20) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
        $episodes = [];
        $seenIds = [];
        $lastNumber = 0;
        foreach ($rows as $row) {
            $id = $row->getAttribute('data-episode-no');
            if (preg_match('/^[1-9][0-9]{0,11}$/D', $id) !== 1 || isset($seenIds[$id])) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
            $seenIds[$id] = true;
            $number = null;
            $bonus = false;
            foreach ($xpath->query('.//div[contains(concat(" ", normalize-space(@class), " "), " ep_style2 ")]//span', $row) ?: [] as $label) {
                $text = trim($label->textContent);
                if ($text === 'BONUS') { $bonus = true; }
                if (preg_match('/^EP\.\s*([1-9][0-9]{0,4})$/D', $text, $match) === 1) { $number = (int)$match[1]; }
            }
            if ($bonus && $number === null) { continue; }
            if ($number === null || $number > 10000 || $number <= $lastNumber || $bonus) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
            // Paid chapters keep their public heading here too; their click
            // handler opens sign-in instead of a viewer, and is never followed.
            $heading = $xpath->query('.//td[contains(concat(" ", normalize-space(@class), " "), " font12 ")]/b[1]', $row)?->item(0);
            if (!$heading instanceof DOMElement) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
            foreach (iterator_to_array($xpath->query('.//i | .//span[starts-with(@class,"b_")]', $heading) ?: []) as $badge) { $badge->parentNode?->removeChild($badge); }
            $title = nas_episode_text(trim((string)preg_replace('/[\s\x{00a0}]+/u', ' ', $heading->textContent)));
            $episodes[] = ['number' => $number, 'title' => $title];
            $lastNumber = $number;
        }
        $active = $xpath->query('//li[contains(concat(" ", normalize-space(@class), " "), " active ")]/*[contains(concat(" ", normalize-space(@class), " "), " page-link ")]')?->item(0);
        $links = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " page-link ")][@onclick]');
        if ($active instanceof DOMElement) {
            if (preg_match('/novel_page_' . preg_quote($productId, '/') . '\x27\]\s*=\s*\x27([0-9]+)\x27/', $active->getAttribute('onclick'), $current) !== 1
                || (int)$current[1] !== $index) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
        } elseif ($index !== 0 || ($links !== false && count($links) > 0)) {
            throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED');
        }
        $lastPage = $index;
        foreach ($links ?: [] as $link) {
            if (preg_match('/novel_page_' . preg_quote($productId, '/') . '\x27\]\s*=\s*\x27([0-9]+)\x27/', $link->getAttribute('onclick'), $match) === 1) { $lastPage = max($lastPage, (int)$match[1]); }
        }
        if ($lastPage > 1000) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
        return ['episodes' => $episodes, 'lastPage' => $lastPage];
    } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
}

function nas_novelpia_raw_page(string $productId, int $index, array &$session, ?callable $fetcher, ?float $deadline = null): array
{
    $key = $productId . ':' . $index;
    $cached = $session['novelpia_raw_episode_cache'][$key] ?? null;
    if (is_array($cached) && ($cached['time'] ?? 0) > time() - 60) { return $cached['value']; }
    $response = nas_novelpia_response('https://novelpia.com/proc/episode_list', 2 * 1024 * 1024, 'episodes',
        ['novel_no' => $productId, 'sort' => 'DOWN', 'page' => $index], $fetcher, $deadline);
    if ($response['type'] !== 'text/html') { throw nas_episode_error(); }
    $value = nas_novelpia_parse_episodes($response['body'], $productId, $index);
    $cache = is_array($session['novelpia_raw_episode_cache'] ?? null) ? $session['novelpia_raw_episode_cache'] : [];
    $cache[$key] = ['time' => time(), 'value' => $value];
    $session['novelpia_raw_episode_cache'] = array_slice($cache, -40, null, true);
    return $value;
}

function nas_novelpia_titles(mixed $productId, mixed $page, array &$session, ?callable $fetcher = null): array
{
    [$productId, $page] = nas_episode_arguments($productId, $page);
    $key = $productId . ':' . $page;
    $cached = $session['novelpia_episode_cache'][$key] ?? null;
    if (is_array($cached) && ($cached['time'] ?? 0) > time() - 60) { return $cached['value']; }
    $deadline = microtime(true) + 12;
    $metadata = nas_novelpia_detail($productId, $session, $fetcher, $deadline);
    $first = ($page - 1) * 30 + 1;
    $last = min($first + 29, $metadata['total']);
    if ($first > $metadata['total']) { throw nas_episode_error('EPISODE_NOT_FOUND'); }
    $found = [];
    $index = intdiv($first - 1, 20);
    // BONUS entries may consume slots. Scan forward using explicit EP labels,
    // and refuse a missing range rather than shifting another chapter's title.
    for ($requests = 0; $requests < 24; $requests++, $index++) {
        if (microtime(true) >= $deadline) { throw nas_episode_error(); }
        $raw = nas_novelpia_raw_page($productId, $index, $session, $fetcher, $deadline);
        if ($requests === 0 && $raw['episodes'] && $raw['episodes'][0]['number'] > $first) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
        foreach ($raw['episodes'] as $episode) {
            $number = $episode['number'];
            if ($number > $metadata['total']) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
            if ($number >= $first && $number <= $last) {
                if (isset($found[$number])) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
                $found[$number] = $episode;
            }
        }
        if (count($found) === $last - $first + 1 || $index >= $raw['lastPage']) { break; }
    }
    if (count($found) !== $last - $first + 1) { throw nas_episode_error('EPISODE_NUMBERING_UNSUPPORTED'); }
    ksort($found, SORT_NUMERIC);
    $value = ['provider' => 'novelpia', 'productId' => $productId, 'page' => $page] + $metadata
        + ['hasMore' => $last < $metadata['total'], 'episodes' => array_values($found)];
    $cache = is_array($session['novelpia_episode_cache'] ?? null) ? $session['novelpia_episode_cache'] : [];
    $cache[$key] = ['time' => time(), 'value' => $value];
    $session['novelpia_episode_cache'] = array_slice($cache, -40, null, true);
    return $value;
}
