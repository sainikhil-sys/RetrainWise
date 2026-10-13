import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="font-serif text-[64px] leading-none">404</div>
      <p className="mt-3 text-[14px] text-ink-2">This page does not exist.</p>
      <Link href="/" className="mt-6 text-[13px] underline underline-offset-4">
        Back to RetrainWise
      </Link>
    </div>
  );
}
