const { extractJson } = require('../../lib/services/claude.js');

// 6 of 28 prop narrations on 2026-10-13 failed as "unparseable": the model
// put real line breaks between the two "detail" paragraphs.
describe('extractJson', () => {
  test('repairs raw line breaks inside a string value', () => {
    const raw = '{"narration": "Short.", "detail": "Para one.\n\nPara two with \\"quotes\\"."}';
    expect(extractJson(raw)).toEqual({ narration: 'Short.', detail: 'Para one.\n\nPara two with "quotes".' });
  });
  test('still parses clean JSON and fenced JSON', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a": "x"}\n```')).toEqual({ a: 'x' });
  });
  test('returns null for text with no object', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});
