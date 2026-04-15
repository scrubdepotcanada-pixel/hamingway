import { google, gmail_v1 } from 'googleapis';

function gmailClient(): gmail_v1.Gmail {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth env vars not configured');
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeHeader(value: string): string {
  // RFC 2047 encoded word for non-ASCII headers
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `=_hemingway_${Date.now()}`;
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');

  const bodyParts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    opts.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    opts.html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return `${headers}\r\n\r\n${bodyParts}`;
}

export async function sendApprovalEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ threadId: string; messageId: string }> {
  const from = process.env.GMAIL_USER_EMAIL;
  if (!from) throw new Error('GMAIL_USER_EMAIL is not set');

  const mime = buildMime({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });

  const raw = toBase64Url(Buffer.from(mime, 'utf8'));
  const gmail = gmailClient();
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    threadId: res.data.threadId ?? '',
    messageId: res.data.id ?? '',
  };
}

/** Get all messages in a thread. Returns the raw Gmail thread object. */
export async function getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
  const gmail = gmailClient();
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return res.data;
}

/** Decode a Gmail message body to plain text (stripping HTML if needed). */
export function extractPlainText(message: gmail_v1.Schema$Message): string {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    parts.push(p);
    (p.parts ?? []).forEach(walk);
  };
  walk(message.payload ?? undefined);

  // Prefer text/plain, fall back to text/html
  const textPart = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  const htmlPart = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  const chosen = textPart ?? htmlPart;
  if (!chosen?.body?.data) return '';

  const decoded = Buffer.from(chosen.body.data, 'base64').toString('utf8');
  if (chosen === htmlPart) {
    // naive html strip
    return decoded
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  return decoded;
}

/**
 * Scan a reply body for a "1", "2", or "3" selection.
 * Accepts things like "1", "Option 2", "I pick 3.", etc.
 * Returns null if no confident match.
 */
export function parseOptionFromReply(body: string): number | null {
  // Take content above any quoted reply history
  const unquoted = body
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');

  // Stop at common reply markers (gmail attribution line)
  const stopIdx = unquoted.search(/^On .+ wrote:$/m);
  const head = stopIdx > 0 ? unquoted.slice(0, stopIdx) : unquoted;

  // Strongest match: line that is just a digit 1/2/3
  const aloneLine = head.match(/^\s*([123])\s*\.?\s*$/m);
  if (aloneLine) return Number(aloneLine[1]);

  // "Option 2", "option #2", "pick 2", "choice 2", "go with 2", "#2"
  const phrase = head.match(/(?:option|choice|pick|go with|#)\s*#?\s*([123])/i);
  if (phrase) return Number(phrase[1]);

  return null;
}
