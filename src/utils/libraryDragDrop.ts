const DRAG_PAYLOAD_PREFIX = 'thisisraw-library-transfer:';

export type LibraryDragPayload = { kind: 'files'; paths: string[] } | { kind: 'folders'; paths: string[] };

export function writeLibraryDragPayload(dataTransfer: DataTransfer, payload: LibraryDragPayload) {
  dataTransfer.effectAllowed = 'copyMove';
  dataTransfer.setData('text/plain', `${DRAG_PAYLOAD_PREFIX}${JSON.stringify(payload)}`);
}

export function readLibraryDragPayload(dataTransfer: DataTransfer): LibraryDragPayload | null {
  try {
    const text = dataTransfer.getData('text/plain');
    if (!text.startsWith(DRAG_PAYLOAD_PREFIX)) return null;

    const payload: unknown = JSON.parse(text.slice(DRAG_PAYLOAD_PREFIX.length));
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'kind' in payload &&
      'paths' in payload &&
      (payload.kind === 'files' || payload.kind === 'folders') &&
      Array.isArray(payload.paths) &&
      payload.paths.every((path) => typeof path === 'string')
    ) {
      return payload;
    }
  } catch {
    // Invalid or unrelated text drops are not library transfers.
  }
  return null;
}

export function mayContainLibraryDragPayload(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('text/plain');
}
