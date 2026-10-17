export type ExternalChannel = 'telegram' | 'whatsapp';

export const CHANNEL_MESSAGE_LIMITS: Record<ExternalChannel, number> = {
  telegram: 4096,
  whatsapp: 1600,
};

/**
 * Render common Markdown in a way that remains readable in the provider's native
 * text renderer. Telegram is sent as plain text (never with unsafe parse_mode);
 * WhatsApp's supported emphasis markers are normalized to its conventions.
 */
export function formatChannelMessage(text: string, channel: ExternalChannel): string {
  let output = String(text ?? '').replace(/\r\n?/g, '\n');
  const codeBlocks: string[] = [];
  output = output.replace(/\x60\x60\x60([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)\x60\x60\x60/g, (_match, language: string, code: string) => {
    const index = codeBlocks.push(channel === 'telegram' && language ? language + '\n' + code.trimEnd() : code.trimEnd()) - 1;
    return `\u0000CHANNEL_CODE_BLOCK_${index}\u0000`;
  });

  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) =>
    channel === 'telegram' ? `${label} (${url})` : `${label}: ${url}`
  );
  output = output.replace(/^\s{0,3}#{1,6}[ \t]+/gm, '');
  output = output.replace(/^\s*[-+*][ \t]+/gm, '• ');

  if (channel === 'telegram') {
    output = output
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
      .replace(/\x60([^\x60\n]+)\x60/g, '$1');
  } else {
    output = output
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
      .replace(/__([^_\n]+)__/g, '_$1_');
  }

  return output.replace(/\u0000CHANNEL_CODE_BLOCK_(\d+)\u0000/g, (_match, index: string) => codeBlocks[Number(index)] ?? '');
}

/**
 * Split after formatting so each provider request stays within its documented
 * text limit. Boundary whitespace is retained; oversized unbroken text is
 * split at a safe UTF-16 boundary without breaking surrogate pairs.
 */
export function splitChannelMessage(text: string, channel: ExternalChannel): string[] {
  const formatted = formatChannelMessage(text, channel);
  if (!formatted.trim()) return [];

  const limit = CHANNEL_MESSAGE_LIMITS[channel];
  const parts: string[] = [];
  let offset = 0;

  while (offset < formatted.length) {
    const remaining = formatted.length - offset;
    if (remaining <= limit) {
      parts.push(formatted.slice(offset));
      break;
    }

    const hardEnd = offset + limit;
    const minimumUsefulBreak = offset + Math.floor(limit * 0.55);
    const lineBreak = formatted.lastIndexOf('\n', hardEnd - 1);
    const spaceBreak = formatted.lastIndexOf(' ', hardEnd - 1);
    let end = lineBreak >= minimumUsefulBreak ? lineBreak + 1 : spaceBreak >= minimumUsefulBreak ? spaceBreak + 1 : hardEnd;

    if (end > offset && end < formatted.length) {
      const previous = formatted.charCodeAt(end - 1);
      const next = formatted.charCodeAt(end);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    }
    if (end <= offset) end = hardEnd;

    parts.push(formatted.slice(offset, end));
    offset = end;
  }

  return parts;
}
