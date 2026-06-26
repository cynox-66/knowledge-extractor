/**
 * Defines the semantic classification of a content block.
 */
export enum BlockType {
  TEXT = 'text',
  HEADING = 'heading',
  QUOTE = 'quote',
  CODE = 'code',
  LIST_ITEM = 'list_item',
  TRANSCRIPT = 'transcript',
}

/**
 * Represents an atomic, semantic chunk of structured text or data.
 * Breaking content into blocks prevents the loss of structural meaning
 * that occurs when flattening rich documents into a single string.
 */
export interface IContentBlock {
  /**
   * The semantic classification of this block.
   */
  type: BlockType;
  /**
   * The textual or structural value of the block.
   */
  value: string;
  /**
   * Optional positional metadata or block-specific attributes.
   */
  metadata?: Record<string, unknown>;
}
