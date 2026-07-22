"use client";

import { SignUp } from "@clerk/react";

/** Client-rendered Clerk sign-up widget. See sign-in-form for why hash routing. */
export function SignUpForm() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <SignUp routing="hash" />
    </div>
  );
}
