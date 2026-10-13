"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/**
 * Staggered entrance for a group of sections. Children (or elements marked
 * `data-reveal`) fade and rise a few pixels. With `scroll`, the reveal waits
 * until the group enters the viewport. Disabled under prefers-reduced-motion.
 */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  stagger = 0.06,
  y = 8,
  duration = 0.32,
  delay = 0,
  scroll = false,
  selector,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  stagger?: number;
  y?: number;
  duration?: number;
  delay?: number;
  scroll?: boolean;
  selector?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const marked = el.querySelectorAll(selector ?? "[data-reveal]");
        const items = marked.length ? marked : el.children;
        gsap.from(items, {
          opacity: 0,
          y,
          duration,
          delay,
          stagger,
          ease: "power2.out",
          clearProps: "opacity,transform",
          scrollTrigger: scroll ? { trigger: el, start: "top 88%", once: true } : undefined,
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}

export type NumberFormat = "int" | "pct" | "pct2" | "money" | "money0" | "fixed1" | "fixed2" | "fixed3" | "pts";

export function formatNumber(value: number, format: NumberFormat): string {
  switch (format) {
    case "int":
      return Math.round(value).toLocaleString("en-US");
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "pct2":
      return `${(value * 100).toFixed(2)}%`;
    case "money":
      return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "money0":
      return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "fixed1":
      return value.toFixed(1);
    case "fixed2":
      return value.toFixed(2);
    case "fixed3":
      return value.toFixed(3);
    case "pts":
      return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)} pts`;
  }
}

/** Number that counts up to its value on first render (static under reduced motion). */
export function AnimatedNumber({ value, format = "int", className }: { value: number; format?: NumberFormat; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !Number.isFinite(value)) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const state = { v: 0 };
        gsap.to(state, {
          v: value,
          duration: 0.7,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = formatNumber(state.v, format);
          },
          onComplete: () => {
            el.textContent = formatNumber(value, format);
          },
        });
      });
      return () => mm.revert();
    },
    { dependencies: [value, format] },
  );
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {Number.isFinite(value) ? formatNumber(value, format) : "—"}
    </span>
  );
}

/** Chart entrance: the plot is wiped in from the left once, subtly. */
export function ChartReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          el,
          { clipPath: "inset(0 100% 0 0)", opacity: 0.4 },
          {
            clipPath: "inset(0 0% 0 0)",
            opacity: 1,
            duration: 0.8,
            ease: "power2.inOut",
            clearProps: "clipPath,opacity",
            scrollTrigger: { trigger: el, start: "top 92%", once: true },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Route transition: quick fade and slide (≈200 ms). */
export function PageTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(ref.current, { opacity: 0, y: 6, duration: 0.2, ease: "power1.out", clearProps: "opacity,transform" });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return <div ref={ref}>{children}</div>;
}
