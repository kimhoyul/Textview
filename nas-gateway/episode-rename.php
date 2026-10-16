<?php
declare(strict_types=1);

function nas_episode_identity_key(string $value): string
{
    if (class_exists('Normalizer')) { $value = Normalizer::normalize($value, Normalizer::FORM_C) ?: $value; }
    $value = preg_replace('/\[(?:독점|완결|연재)\]/u', '', $value) ?? '';
    return strtolower(preg_replace('/\s+/u', '', $value) ?? '');
}

function nas_episode_folder_matches(string $folder, string $title, string $author): bool
{
    $name = basename($folder);
    // Remove only explicit status/range suffixes, never arbitrary words or author guesses.
    for ($i = 0; $i < 4; $i++) {
        $previous = $name;
        $name = preg_replace('/(?:\s*\[(?:완결|완|연재|독점)\]|\s*\((?:완결|완)\)|\s+(?:완결|完))\s*$/u', '', $name) ?? '';
        if ($author !== '') { $name = preg_replace('/\s*[\[(]' . preg_quote($author, '/') . '[\])]\s*$/u', '', $name) ?? ''; }
        $name = preg_replace('/\s+[1-9][0-9]{0,4}\s*[-~]\s*[1-9][0-9]{0,4}\s*(?:화|회)?\s*$/u', '', $name) ?? '';
        if ($name === $previous) { break; }
    }
    return nas_episode_identity_key($name) === nas_episode_identity_key($title);
}

/** Numeric-only originals share the app's strict matching rules. Named TXT files are preserved. */
function nas_episode_original_number(string $name, string $book): ?int
{
    if (!SynologyClient::isTxtPath($name)) { return null; }
    $stem = trim(substr($name, 0, -4));
    foreach ([$book, '[' . $book . ']'] as $prefix) {
        if ($prefix !== '' && str_starts_with($stem, $prefix)
            && preg_match('/^[\s._-]/u', substr($stem, strlen($prefix))) === 1) {
            $stem = preg_replace('/^[\s._-]+/u', '', substr($stem, strlen($prefix))) ?? '';
            break;
        }
    }
    if (preg_match('/^(?:제\s*)?([0-9]{1,6})\s*(?:화|회)?$/uD', $stem, $match) !== 1) { return null; }
    $number = (int)$match[1];
    return $number >= 1 && $number <= 10000 ? $number : null;
}

function nas_episode_titled_number(string $name): ?int
{
    if (preg_match('/^([0-9]{1,6})화 .+\.txt$/uiD', $name, $match) !== 1) { return null; }
    $number = (int)$match[1];
    return $number >= 1 && $number <= 10000 ? $number : null;
}

function nas_episode_target_name(int $number, string $subtitle): ?string
{
    $safe = strtr($subtitle, ['<' => '＜', '>' => '＞', ':' => '：', '"' => '＂', '/' => '／',
        '\\' => '＼', '|' => '｜', '?' => '？', '*' => '＊']);
    $safe = trim(preg_replace('/[\p{Cc}\s]+/u', ' ', $safe) ?? '');
    $name = $number . '화 ' . $safe . '.txt';
    return $safe !== '' && strlen($name) <= 240 ? $name : null;
}

/** Request data supplies source references only; target names always come from verified public metadata. */
function nas_sync_episode_names(SynologyClient $client, array $input, array &$session, ?callable $fetcher = null): array
{
    if (!is_array($session['dsm'] ?? null)) { throw nas_error('SESSION_EXPIRED'); }
    $folder = SynologyClient::validatePath($input['folder'] ?? null, false);
    if (substr_count($folder, '/') < 2) { throw nas_error('INVALID_REQUEST'); }
    $paths = $input['paths'] ?? null;
    if (!is_array($paths) || !array_is_list($paths) || count($paths) < 1 || count($paths) > 30) { throw nas_error('INVALID_REQUEST'); }
    $seen = [];
    foreach ($paths as $path) {
        SynologyClient::validatePath($path, false);
        if (dirname($path) !== $folder || !SynologyClient::isTxtPath($path) || isset($seen[$path])) { throw nas_error('INVALID_REQUEST'); }
        $seen[$path] = true;
    }
    $expectedTitle = nas_episode_text($input['expectedTitle'] ?? null);
    $expectedAuthor = nas_episode_text($input['expectedAuthor'] ?? null, true);
    $metadata = nas_episode_titles($input['productId'] ?? null, $input['page'] ?? null, $session, $fetcher);
    if (nas_episode_identity_key($expectedTitle) !== nas_episode_identity_key($metadata['title'])
        || ($expectedAuthor !== '' && nas_episode_identity_key($expectedAuthor) !== nas_episode_identity_key($metadata['author']))
        || !nas_episode_folder_matches($folder, $metadata['title'], $metadata['author'])) {
        throw new GatewayError('EPISODE_IDENTITY_MISMATCH', 409, 'NAS 폴더와 작품 정보가 일치하지 않아 파일 이름을 바꾸지 않았습니다.');
    }
    $episodes = [];
    foreach ($metadata['episodes'] as $episode) { $episodes[$episode['number']] = $episode['title']; }
    $plan = [];
    // Validate the entire batch before performing a write.
    foreach ($paths as $path) {
        $original = nas_episode_original_number(basename($path), $metadata['title']);
        $number = $original ?? nas_episode_titled_number(basename($path));
        if ($number !== null && ($number <= ($metadata['page'] - 1) * 30 || $number > $metadata['page'] * 30)) { throw nas_error('INVALID_REQUEST'); }
        $targetName = isset($episodes[$number ?? 0]) ? nas_episode_target_name($number, $episodes[$number]) : null;
        if ($targetName !== null) { SynologyClient::validatePath($folder . '/' . $targetName, false); }
        $plan[] = ['oldPath' => $path, 'number' => $number, 'original' => $original,
            'targetName' => $targetName, 'newPath' => $targetName !== null ? $folder . '/' . $targetName : $path];
    }
    $entries = $client->episodeRenameEntries($folder);
    $byNumber = [];
    foreach ($entries as $path => $item) {
        $number = nas_episode_original_number($item['name'], $metadata['title']) ?? nas_episode_titled_number($item['name']);
        if ($number !== null) { $byNumber[$number][] = $path; }
    }
    $results = [];
    foreach ($plan as $item) {
        $path = $item['oldPath'];
        $targetName = $item['targetName'];
        $base = ['oldPath' => $path, 'path' => $path, 'newPath' => $item['newPath'], 'name' => basename($path),
            'newName' => basename($item['newPath']), 'number' => $item['number']];
        if ($targetName === null) { $results[] = $base + ['status' => 'skipped', 'reason' => 'no_verified_title']; continue; }
        if ($item['original'] === null && basename($path) !== $targetName) { $results[] = $base + ['status' => 'skipped', 'reason' => 'already_titled']; continue; }
        if (count($byNumber[$item['number']] ?? []) > 1) { $results[] = $base + ['status' => 'conflict', 'reason' => 'duplicate_number']; continue; }
        $outcome = $client->renameEpisodeFile($path, $targetName, $entries[$path] ?? null);
        $results[] = array_replace($base, $outcome);
    }
    $counts = array_count_values(array_column($results, 'status'));
    return ['ok' => true, 'folder' => $folder, 'productId' => $metadata['productId'], 'page' => $metadata['page'],
        'title' => $metadata['title'], 'author' => $metadata['author'], 'results' => $results,
        'renamed' => $counts['renamed'] ?? 0, 'unchanged' => $counts['unchanged'] ?? 0,
        'conflicts' => $counts['conflict'] ?? 0, 'skipped' => ($counts['skipped'] ?? 0) + ($counts['missing'] ?? 0)];
}
