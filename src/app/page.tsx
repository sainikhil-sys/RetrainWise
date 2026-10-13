import Link from "next/link";

export default function Home() {
  return (
    <main className="p-10">
      <h1 className="font-serif text-5xl">RetrainWise</h1>
      <Link href="/signin" className="underline">Sign in</Link>
    </main>
  );
}
