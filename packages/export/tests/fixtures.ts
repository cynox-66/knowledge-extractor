import { type IResource, ResourceState, BlockType, MediaType } from '@knowledge-extractor/types';

export function makeResource(id: string, overrides: Partial<IResource> = {}): IResource {
  return {
    id,
    kind: 'post',
    state: ResourceState.ENRICHED,
    source: {
      providerName: 'instagram',
      externalId: id,
      originalUri: `https://www.instagram.com/p/${id}/`,
      extractedAt: '2024-01-15T10:00:00.000Z',
    },
    author: {
      handle: '@testuser',
      displayName: 'Test User',
    },
    content: [
      { type: BlockType.TEXT, value: 'Hello world' },
      { type: BlockType.HEADING, value: 'Section A' },
    ],
    media: [
      { id: `${id}_img0`, type: MediaType.IMAGE, sourceUri: 'https://cdn.example.com/img0.jpg' },
      { id: `${id}_vid1`, type: MediaType.VIDEO, sourceUri: 'https://cdn.example.com/vid1.mp4' },
    ],
    completeness: { thumbnail: true, metadata: true, media: true, ocr: true },
    ...overrides,
  };
}
