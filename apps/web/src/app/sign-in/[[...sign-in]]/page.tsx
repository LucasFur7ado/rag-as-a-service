import { SignInForm } from "@/components/sign-in-form";

// `output: export` requires every dynamic route to enumerate its params at
// build time; only the bare `/sign-in` segment is emitted. The page shell is
// prerendered and <SignInForm> is the client island that mounts Clerk.
export function generateStaticParams() {
  return [{ "sign-in": [] as string[] }];
}

export default function SignInPage() {
  return <SignInForm />;
}
