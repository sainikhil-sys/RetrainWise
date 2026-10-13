import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState icon={Compass} title="Page not found" className="mt-16" action={<Link href="/" className="text-sm font-medium text-teal-300 hover:underline">Back to the overview</Link>}>
      This page does not exist.
    </EmptyState>
  );
}
