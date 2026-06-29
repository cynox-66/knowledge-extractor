import { describe, it, expect } from 'vitest';
import { BlockType } from '@knowledge-extractor/types';
import type { IContentBlock } from '@knowledge-extractor/types';
import { renderBlock } from '../src/block-renderer.js';

function block(type: BlockType, value: string): IContentBlock {
  return { type, value };
}

describe('renderBlock — all BlockType variants', () => {
  it('TEXT renders as a plain paragraph', () => {
    expect(renderBlock(block(BlockType.TEXT, 'Hello world'))).toBe('Hello world');
  });

  it('HEADING renders as h2', () => {
    expect(renderBlock(block(BlockType.HEADING, 'Section A'))).toBe('## Section A');
  });

  it('QUOTE renders as a blockquote', () => {
    expect(renderBlock(block(BlockType.QUOTE, 'Wise words'))).toBe('> Wise words');
  });

  it('CODE renders as a fenced code block', () => {
    const result = renderBlock(block(BlockType.CODE, 'const x = 1;'));
    expect(result).toBe('```\nconst x = 1;\n```');
  });

  it('LIST_ITEM renders as a bullet point', () => {
    expect(renderBlock(block(BlockType.LIST_ITEM, 'Item one'))).toBe('- Item one');
  });

  it('TRANSCRIPT renders with a bold header and the value on a new paragraph', () => {
    const result = renderBlock(block(BlockType.TRANSCRIPT, 'She said hello.'));
    expect(result).toBe('**[Transcript]**\n\nShe said hello.');
  });

  it('is deterministic — same input yields same output', () => {
    const b = block(BlockType.HEADING, 'Repeat');
    expect(renderBlock(b)).toBe(renderBlock(b));
  });

  it('does not mutate the input block', () => {
    const b = block(BlockType.TEXT, 'immutable');
    const before = JSON.stringify(b);
    renderBlock(b);
    expect(JSON.stringify(b)).toBe(before);
  });
});
