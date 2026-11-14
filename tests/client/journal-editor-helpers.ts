import { act, fireEvent } from '@testing-library/react';
import { expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { plainTextToJournalDocument } from '../../src/shared/journal-content.js';
import type { JSONContent } from '@tiptap/core';
/** jsdom has no native editing engine. Exercise the real ProseMirror transaction. */
export function changeJournalField(
  node: HTMLElement,
  init: { target: { value: string } },
) {
  if (node.hasAttribute('contenteditable')) {
    const editor = (node as HTMLElement & { editor: Editor }).editor;
    act(() => {
      editor.commands.setContent(
        plainTextToJournalDocument(init.target.value) as JSONContent,
        { emitUpdate: true },
      );
    });
    return;
  }
  fireEvent.change(node, init);
}
export function expectJournalFieldValue(
  node: HTMLElement | null,
  expected: unknown,
) {
  expect(node).not.toBeNull();
  const actual = node!.hasAttribute('contenteditable')
    ? (node as HTMLElement & { editor: Editor }).editor.getText({
        blockSeparator: '\n',
      })
    : (node as HTMLInputElement).value;
  expect(actual).toBe(expected);
}

if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}

if (typeof document !== 'undefined') {
  document.elementFromPoint ??= () => null;
}
