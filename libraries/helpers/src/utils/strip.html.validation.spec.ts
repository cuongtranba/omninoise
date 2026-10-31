import { expect, test } from 'vitest';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

test('entities from the editor are decoded to plain text for every output type', () => {
  const input = '<p>Tom &amp; Jerry say "hi" &lt; 3</p>';
  const text = 'Tom & Jerry say "hi" < 3';

  expect(stripHtmlValidation('normal', input, true)).toBe(text);
  expect(stripHtmlValidation('markdown', input)).toBe(`${text}\n`);
  expect(stripHtmlValidation('none', input)).toBe(text);
  expect(
    stripHtmlValidation('normal', '<p><strong>a &amp; b</strong></p>', true)
  ).toBe('𝗮 & 𝗯');
});

test('a literally typed entity is decoded once and never becomes markup', () => {
  const input = '<p>&amp;lt;b&amp;gt; &amp;quot;x&amp;quot;</p>';
  const text = '&lt;b&gt; &quot;x&quot;';

  expect(stripHtmlValidation('normal', input, true)).toBe(text);
  expect(stripHtmlValidation('markdown', input)).toBe(`${text}\n`);
  expect(stripHtmlValidation('html', input)).toBe(`<p>${text}</p>`);
  expect(stripHtmlValidation('none', input)).toBe(text);
});
