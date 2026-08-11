import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'oa_session';

/**
 * Route gate. This only checks that a session cookie exists — the actual signature
 * check happens server-side in every API route and page via requireUser(), because
 * middleware runs on the edge runtime where our JWT verification and DB are not
 * available. It exists to redirect, not to authorise.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    if (hasSession) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except API routes, static assets and the tracking endpoints.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)).*)'],
};
