import {
  IInstagramParsedPost,
  IResource,
  ResourceState,
  MediaType,
  BlockType,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/**
 * The Instagram Parser understands Instagram-specific DOM and structured data.
 * It accepts a parsed `IInstagramParsedPost` and enriches it before
 * handing off to the Connector for domain normalization.
 *
 * Responsibility: Instagram semantics.
 * NOT responsible for: domain model creation (that is the Connector's job).
 */
export class InstagramParser {
  private readonly logger = new Logger('InstagramParser');

  /**
   * Validates and enriches a parsed post. Returns the same type with
   * any correctable fields filled in.
   */
  enrich(post: IInstagramParsedPost): IInstagramParsedPost {
    this.logger.debug(`Enriching parsed post: ${post.sourceUri}`);

    // Deduplicate media URIs while preserving order
    const uniqueMedia = [...new Set(post.mediaUris)];

    // Detect layout if it came through as 'unknown'
    let layout = post.layout;
    if (layout === 'unknown') {
      if (post.videoUri) layout = 'reel';
      else if (uniqueMedia.length > 1) layout = 'carousel';
      else layout = 'single-image';
    }

    return { ...post, mediaUris: uniqueMedia, layout };
  }
}

/**
 * Normalizes an enriched `IInstagramParsedPost` into a strict domain `IResource`.
 * Understands the platform contracts; does not understand Instagram specifics.
 */
export class InstagramNormalizer {
  private readonly logger = new Logger('InstagramNormalizer');

  normalize(post: IInstagramParsedPost): IResource {
    this.logger.info(`Normalizing post: ${post.externalId}`);

    const media = post.mediaUris.map((uri, idx) => ({
      id: `${post.externalId}_media_${idx}`,
      type: post.videoUri === uri ? MediaType.VIDEO : MediaType.IMAGE,
      sourceUri: uri,
    }));

    const result: any = {
      id: `ig_${post.externalId || this.djb2(post.sourceUri)}`,
      kind: post.layout === 'reel' ? 'instagram-reel' : 'instagram-post',
      state: ResourceState.EXTRACTED,
      completeness: { thumbnail: true, metadata: true, media: true, ocr: false },
      source: {
        providerName: 'instagram',
        externalId: post.externalId ?? 'unknown',
        originalUri: post.sourceUri,
        extractedAt: new Date().toISOString(),
        metadata: { layout: post.layout },
      },
      content: post.textContent ? [{ type: BlockType.TEXT, value: post.textContent }] : [],
      media,
      children:
        post.layout === 'carousel'
          ? (post.slideUris ?? post.mediaUris).map((uri, idx) => ({
              id: `ig_${post.externalId}_slide_${idx}`,
              kind: 'instagram-slide',
              state: ResourceState.EXTRACTED,
              completeness: { thumbnail: true, metadata: true, media: true, ocr: false },
              source: {
                providerName: 'instagram',
                externalId: `${post.externalId}_slide_${idx}`,
                originalUri: post.sourceUri,
                extractedAt: new Date().toISOString(),
              },
              content: [],
              media: [{ id: `slide_media_${idx}`, type: MediaType.IMAGE, sourceUri: uri }],
            }))
          : [],
    };

    if (post.authorHandle) {
      result.author = {
        handle: post.authorHandle,
        ...(post.authorDisplayName ? { displayName: post.authorDisplayName } : {}),
      };
    }

    return result;
  }

  private djb2(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
