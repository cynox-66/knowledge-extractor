import { BlockType } from '@knowledge-extractor/types';
import type { IContentBlock } from '@knowledge-extractor/types';

/**
 * Renders a single IContentBlock to a Markdown string fragment.
 * Shared between MarkdownSerializer and ObsidianSerializer (M5).
 * Pure: no side effects, no imports beyond types.
 */
export function renderBlock(block: IContentBlock): string {
  switch (block.type) {
    case BlockType.TEXT:
      return block.value;
    case BlockType.HEADING:
      return `## ${block.value}`;
    case BlockType.QUOTE:
      return `> ${block.value}`;
    case BlockType.CODE:
      return `\`\`\`\n${block.value}\n\`\`\``;
    case BlockType.LIST_ITEM:
      return `- ${block.value}`;
    case BlockType.TRANSCRIPT:
      return `**[Transcript]**\n\n${block.value}`;
  }
}
