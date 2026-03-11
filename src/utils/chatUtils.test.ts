import { CITATION_REGEX } from './chatUtils';

describe('CITATION_REGEX', () => {
  it('should match bracketed source IDs with Polish characters and spaces', () => {
    const text = 'Some info [Source: Opowieści z Puszczy_v1.docx_220469_1773143228000]';
    const matches = [...text.matchAll(CITATION_REGEX)];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe('Opowieści z Puszczy_v1.docx_220469_1773143228000');
  });

  it('should match numeric citations [1]', () => {
    const text = 'Claim [1] and [2, 3]';
    const matches = [...text.matchAll(CITATION_REGEX)];
    expect(matches.length).toBe(2);
    expect(matches[0][2]).toBe('1');
    expect(matches[1][2]).toBe('2, 3');
  });

  it('should match unbracketed Source: format with non-ASCII', () => {
    const text = 'Check Source: Opowieści.docx_123_456 more info';
    const matches = [...text.matchAll(CITATION_REGEX)];
    expect(matches.length).toBe(1);
    expect(matches[0][5]).toBe('Opowieści.docx_123_456');
  });
});
