import { textToHtml } from '../utils';

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export type RenderOptions = {
  bodyText: string;
  signature?: string | null;
  trackingId: string;
  trackOpens: boolean;
  trackClicks: boolean;
  unsubscribeFooter: boolean;
};

export type RenderedEmail = {
  text: string;
  html: string;
  unsubscribeUrl: string;
};

/**
 * Turns the approved plain-text body into the multipart bodies we actually send.
 *
 * Open tracking is a 1x1 pixel; click tracking rewrites links through a redirect
 * endpoint. Both are keyed by the message's own tracking id so we can attribute
 * events to a specific send rather than to the campaign as a whole.
 */
export function renderEmail(opts: RenderOptions): RenderedEmail {
  const base = appUrl();
  const unsubscribeUrl = `${base}/api/t/u/${opts.trackingId}`;

  const signature = opts.signature?.trim();
  const textParts = [opts.bodyText.trim()];
  if (signature) textParts.push(signature);

  let html = textToHtml(opts.bodyText.trim());
  if (signature) {
    html += `<div style="margin-top:20px;color:#444;">${textToHtml(signature)}</div>`;
  }

  if (opts.trackClicks) {
    html = rewriteLinks(html, opts.trackingId, base);
  }

  if (opts.unsubscribeFooter) {
    textParts.push(`\n---\nIf you'd rather not hear from me, unsubscribe: ${unsubscribeUrl}`);
    html += `<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
If you'd rather not hear from me, <a href="${unsubscribeUrl}" style="color:#888;">unsubscribe</a>.
</div>`;
  }

  if (opts.trackOpens) {
    html += `<img src="${base}/api/t/o/${opts.trackingId}" width="1" height="1" alt="" style="display:block;border:0;" />`;
  }

  return {
    text: textParts.join('\n\n'),
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;">${html}</div>`,
    unsubscribeUrl,
  };
}

/** Route outbound links through the click-tracking redirect. */
function rewriteLinks(html: string, trackingId: string, base: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    // Don't rewrite our own tracking/unsubscribe endpoints.
    if (url.startsWith(`${base}/api/t/`)) return match;
    return `href="${base}/api/t/c/${trackingId}?u=${encodeURIComponent(url)}"`;
  });
}

/** Follow-ups reuse the original subject with a Re: prefix, like a human would. */
export function threadSubject(original: string, stage: number): string {
  if (stage === 0) return original;
  return /^re:\s*/i.test(original) ? original : `Re: ${original}`;
}
