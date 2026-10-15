import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { validateSubtitle, MAX_SUBTITLE_BYTES } from './subtitle-file';

const srt = '1\n00:00:01,000 --> 00:00:03,000\nZażółć gęślą jaźń.\n';
function zip(name: string, data: Buffer, declared = data.length) {
  const encoded = Buffer.from(name),
    compressed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(encoded.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(encoded.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + encoded.length, 12);
  end.writeUInt32LE(local.length + encoded.length + compressed.length, 16);
  return Buffer.concat([local, encoded, compressed, central, encoded, end]);
}
it('normalizes UTF-8 BOM and CRLF, validates ASS/VTT/MicroDVD', () => {
  expect(validateSubtitle(Buffer.from('\uFEFF' + srt.replaceAll('\n', '\r\n')), 'x.srt', 'pl')).toEqual({
    text: srt,
    extension: '.srt',
  });
  for (const [name, text] of [
    ['x.ass', '[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello'],
    ['x.vtt', 'WEBVTT\n\n00:01.000 --> 00:03.000\nHello'],
    ['x.sub', '{1}{25}Hello'],
  ])
    expect(validateSubtitle(Buffer.from(text!), name!, 'en').text).toContain('Hello');
});
it('decodes legacy Polish windows-1250 and ISO-8859-2', () => {
  const prefix = Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n');
  expect(validateSubtitle(Buffer.concat([prefix, Buffer.from([0x9c, 0xb3, 0xb9])]), 'x.srt', 'pl').text).toContain(
    'śłą',
  );
  expect(validateSubtitle(Buffer.concat([prefix, Buffer.from([0xb6, 0xb3, 0xb1])]), 'x.srt', 'pl').text).toContain(
    'śłą',
  );
});
it('accepts bounded ZIP and gzip content and never uses archive paths for output', () => {
  expect(validateSubtitle(zip('folder/polskie.srt', Buffer.from(srt)), 'archive.zip', 'pl').text).toBe(srt);
  expect(validateSubtitle(gzipSync(Buffer.from(srt)), 'polskie.srt.gz', 'pl').text).toBe(srt);
});
it.each(['../evil.srt', 'C:/evil.srt', '/evil.srt', 'x.exe', 'CON.srt'])('rejects unsafe ZIP entry %s', (name) => {
  expect(() => validateSubtitle(zip(name, Buffer.from(srt)), 'x.zip', 'pl')).toThrow('SUBS_BAD_FILE');
});
it('rejects bombs (including lying ZIP sizes), corrupt CRC, HTML, binary and oversized plain files', () => {
  const bomb = Buffer.alloc(MAX_SUBTITLE_BYTES + 1, 65);
  const corrupt = zip('x.srt', Buffer.from(srt));
  corrupt[14] = corrupt[14]! ^ 1; // central CRC is checked below separately
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt[central + 16] = corrupt[central + 16]! ^ 1;
  for (const [data, name] of [
    [gzipSync(bomb), 'x.srt.gz'],
    [zip('x.srt', bomb, 1), 'x.zip'],
    [corrupt, 'x.zip'],
    [Buffer.from('<html>' + srt), 'x.srt'],
    [Buffer.from(srt + '\0'), 'x.srt'],
    [bomb, 'x.srt'],
    [Buffer.from('no timestamps'), 'x.srt'],
  ] as const)
    expect(() => validateSubtitle(data, name, 'pl')).toThrow('SUBS_BAD_FILE');
});
