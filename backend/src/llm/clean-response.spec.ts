import { stripPreamble } from './clean-response';

describe('stripPreamble', () => {
  it.each([
    [
      "Sure, here's the explanation of the document in 3 paragraphs:\n\nThe invoice is from ACME.",
      'The invoice is from ACME.',
    ],
    ['Sure! Here is a summary of the document:\nACME billed $42.', 'ACME billed $42.'],
    ['Certainly. Below is an explanation of the document:\n\nIt is a receipt.', 'It is a receipt.'],
    ['Here are the main points:\n- total 42', '- total 42'],
    ['**Explanation:**\nThe document is a receipt.', 'The document is a receipt.'],
    ['Explanation:\nThe document is a receipt.', 'The document is a receipt.'],
    ['Sure, the total amount is 42.', 'The total amount is 42.'],
    ['Okay, the due date is December 1.', 'The due date is December 1.'],
  ])('removes filler from %j', (input, expected) => {
    expect(stripPreamble(input)).toBe(expected);
  });

  it.each([
    'The invoice from ACME totals $42.',
    'Here is an invoice from ACME for $42.',
    'This is a receipt issued on December 1.',
    'Summary of charges: rent 100, water 20.',
    'Sure Corp. issued this invoice.',
  ])('keeps content that is not filler: %j', (input) => {
    expect(stripPreamble(input)).toBe(input);
  });

  it('keeps paragraph breaks in the body', () => {
    expect(stripPreamble('Sure:\n\nFirst paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph.\n\nSecond paragraph.',
    );
  });

  it('never returns an empty string', () => {
    expect(stripPreamble('Sure!')).toBe('Sure!');
  });
});
