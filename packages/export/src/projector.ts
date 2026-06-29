import type {
  IResource,
  IMedia,
  IExportItem,
  IExportMediaRef,
  MediaInclusion,
} from '@knowledge-extractor/types';

/**
 * Pure projection: IResource + caller-supplied presence information → IExportItem.
 *
 * The caller (Layer 4 ExportCoordinator) is responsible for building
 * `presentMediaIds` by querying IMediaStore, keeping this function storage-free.
 */
export function project(
  resource: IResource,
  presentMediaIds: ReadonlySet<string>,
  inclusion: MediaInclusion,
): IExportItem {
  const projectedChildren = resource.children?.map((child) =>
    project(child, presentMediaIds, inclusion),
  );

  return {
    resourceId: resource.id,
    kind: resource.kind,
    frontmatter: buildFrontmatter(resource),
    body: resource.content,
    media: resource.media.map((m) => resolveMediaRef(m, presentMediaIds, inclusion)),
    ...(projectedChildren !== undefined ? { children: projectedChildren } : {}),
  };
}

function buildFrontmatter(resource: IResource): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    sourceUrl: resource.source.originalUri ?? null,
    providerName: resource.source.providerName,
    externalId: resource.source.externalId,
    extractedAt: resource.source.extractedAt,
  };

  if (resource.author !== undefined) {
    fm['author'] = {
      handle: resource.author.handle,
      ...(resource.author.displayName !== undefined
        ? { displayName: resource.author.displayName }
        : {}),
      ...(resource.author.profileUri !== undefined
        ? { profileUri: resource.author.profileUri }
        : {}),
    };
  }

  if (resource.source.metadata !== undefined) {
    fm['sourceMetadata'] = resource.source.metadata;
  }

  return fm;
}

function resolveMediaRef(
  media: IMedia,
  presentMediaIds: ReadonlySet<string>,
  inclusion: MediaInclusion,
): IExportMediaRef {
  // embed-remote blobs that were successfully pre-fetched by the coordinator
  // appear in presentMediaIds and should receive a local path just like link-local.
  const hasLocalBlob =
    presentMediaIds.has(media.id) && (inclusion === 'link-local' || inclusion === 'embed-remote');
  return {
    mediaId: media.id,
    type: media.type,
    sourceUri: media.sourceUri,
    ...(hasLocalBlob ? { localPath: `media/${media.id}` } : {}),
  };
}
