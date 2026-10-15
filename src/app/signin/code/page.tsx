import type { Metadata } from "next";

import { AuthFrame } from "../auth-frame";
import { CopyCode } from "./copy-code";

export const metadata: Metadata = { title: "Your sign-in code", robots: { index: false } };

/** Opened from "Copy code" in the sign-in email. The code is in the URL fragment, read only in the browser. */
export default function CodePage() {
  return (
    <AuthFrame>
      <CopyCode />
    </AuthFrame>
  );
}
