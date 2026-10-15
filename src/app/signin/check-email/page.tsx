import { redirect } from "next/navigation";

/** Sign-in now uses a code entered on /signin/verify. */
export default function CheckEmailPage() {
  redirect("/signin/verify");
}
