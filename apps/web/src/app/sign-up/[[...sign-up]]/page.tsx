import { SignUpForm } from "@/components/sign-up-form";

// See the sign-in page: params enumerated for `output: export`, Clerk mounted
// client-side inside <SignUpForm>.
export function generateStaticParams() {
  return [{ "sign-up": [] as string[] }];
}

export default function SignUpPage() {
  return <SignUpForm />;
}
