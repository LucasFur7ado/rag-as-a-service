"use client";

import { SignIn } from "@clerk/react";

/**
 * Client-rendered Clerk sign-in widget.
 *
 * `routing="hash"` keeps Clerk's multi-step flow (factor-one, sso-callback, …)
 * in the URL hash. With `output: export` only `/sign-in/index.html` exists on
 * disk, so path routing would 404 on a plain static host.
 */
export function SignInForm() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <SignIn routing="hash" />
    </div>
  );
}
