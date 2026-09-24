import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig } from "./app/lib/supabase/config";
import {
  SUPABASE_COOKIE_PREFIX,
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_COOKIE_PATH,
} from "./app/lib/session-cookies";

/**
 * Refreshes the Supabase session cookie on every admin request and bounces
 * signed-out visitors to the login page.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`; Supabase's own
 * docs still show the old name. Authorization is NOT decided here alone —
 * every admin page and server action re-checks via requireStaff().
 */
export async function proxy(request: NextRequest) {
  // Without credentials there is no session to refresh. The admin pages render
  // a setup notice instead, so let the request through rather than erroring.
  if (!hasSupabaseConfig()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase; getSession() would trust
  // whatever the cookie claims, so it must not be used for a security check.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // A session cookie whose refresh token no longer exists in the project —
  // after the project was swapped, its auth data reset, or the token revoked —
  // is retried on every request and never recovers on its own, because the
  // browser keeps sending it. Expire it here so one redirect to the login page
  // ends it, rather than every page load failing the same way.
  //
  // Only when Supabase actually rejected something: a visitor with no cookie
  // at all reports a missing session, and there is nothing to clear.
  const staleSession =
    Boolean(authError) &&
    !user &&
    request.cookies.getAll().some((c) => c.name.startsWith(SUPABASE_COOKIE_PREFIX));

  const clearStaleSession = (res: NextResponse) => {
    if (!staleSession) return res;
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith(SUPABASE_COOKIE_PREFIX)) {
        res.cookies.set({ name: cookie.name, value: "", path: "/", maxAge: 0 });
      }
    }
    // The second-factor marker is bound to a user who is no longer signed in.
    res.cookies.set({
      name: TWO_FACTOR_COOKIE,
      value: "",
      path: TWO_FACTOR_COOKIE_PATH,
      maxAge: 0,
    });
    return res;
  };

  const { pathname } = request.nextUrl;
  // /admin/login/verify is the second sign-in step, reached with a session.
  const isLoginRoute = pathname === "/admin/login";
  const isVerifyRoute = pathname === "/admin/login/verify";

  if (!user && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.search = "";
    if (!isVerifyRoute) loginUrl.searchParams.set("next", pathname);
    return clearStaleSession(NextResponse.redirect(loginUrl));
  }

  if (user && isLoginRoute) {
    const adminUrl = request.nextUrl.clone();
    adminUrl.pathname = "/admin";
    adminUrl.search = "";
    return NextResponse.redirect(adminUrl);
  }

  return clearStaleSession(response);
}

export const config = {
  matcher: ["/admin/:path*"],
};
