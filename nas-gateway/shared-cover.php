<?php
declare(strict_types=1);

function nas_shared_cover_invalid(): GatewayError
{
    return new GatewayError('SHARED_COVER_INVALID', 502, '저장된 작품 표지를 확인하지 못했습니다. 기존 표지를 유지합니다.');
}

function nas_shared_cover_revision(mixed $revision): ?string
{
    if ($revision === null) { return null; }
    if (!is_string($revision) || preg_match('/^[a-f0-9]{64}$/Di', $revision) !== 1) { throw nas_error('INVALID_REQUEST'); }
    return strtolower($revision);
}

/** Shared covers contain display values only; they do not verify provider identity. */
function nas_shared_cover_metadata(string $raw, string $folder): array
{
    if (strlen($raw) > 8192) { throw nas_shared_cover_invalid(); }
    try { $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw nas_shared_cover_invalid(); }
    if (!is_array($data) || ($data['schemaVersion'] ?? null) !== 1 || ($data['folder'] ?? null) !== $folder
        || !is_string($data['revision'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $data['revision']) !== 1
        || !is_int($data['width'] ?? null) || !is_int($data['height'] ?? null)
        || $data['width'] < 1 || $data['height'] < 1 || $data['width'] > 1536 || $data['height'] > 1536
        || !is_string($data['updatedAt'] ?? null)
        || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/D', $data['updatedAt']) !== 1) {
        throw nas_shared_cover_invalid();
    }
    foreach (['title', 'author', 'sourceName'] as $field) {
        if (!is_string($data[$field] ?? null) || strlen($data[$field]) > 1200 || preg_match('/\A.{0,300}\z/us', $data[$field]) !== 1
            || preg_match('/\p{Cc}/u', $data[$field]) === 1 || ($field === 'title' && trim($data[$field]) === '')) { throw nas_shared_cover_invalid(); }
    }
    return array_intersect_key($data, array_flip(['schemaVersion', 'folder', 'revision', 'title', 'author', 'sourceName', 'width', 'height', 'updatedAt']));
}

/** Every lookup reauthorizes the exact work folder and manifest with DSM. */
function nas_get_shared_cover(SynologyClient $client, mixed $folder, mixed $revision = null): array
{
    $revision = nas_shared_cover_revision($revision);
    $folder = SynologyClient::validatePath($folder, false);
    $client->authorizeSharedCoverFolder($folder);
    $raw = $client->sharedCoverAsset($folder);
    if ($raw === null) { return ['ok' => true, 'cover' => null]; }
    $metadata = nas_shared_cover_metadata($raw, $folder);
    if ($revision !== null && hash_equals($metadata['revision'], $revision)) {
        return ['ok' => true, 'cover' => $metadata + ['unchanged' => true]];
    }
    $image = $client->sharedCoverAsset($folder, $metadata['revision']);
    if ($image === null) { return ['ok' => true, 'cover' => null]; }
    if (!hash_equals($metadata['revision'], hash('sha256', $image)) || !function_exists('getimagesizefromstring')) { throw nas_shared_cover_invalid(); }
    $size = @getimagesizefromstring($image);
    if (!is_array($size) || ($size[2] ?? null) !== IMAGETYPE_JPEG || ($size['mime'] ?? null) !== 'image/jpeg'
        || $size[0] !== $metadata['width'] || $size[1] !== $metadata['height']) { throw nas_shared_cover_invalid(); }
    return ['ok' => true, 'cover' => $metadata + ['imageDataURL' => 'data:image/jpeg;base64,' . base64_encode($image)]];
}
