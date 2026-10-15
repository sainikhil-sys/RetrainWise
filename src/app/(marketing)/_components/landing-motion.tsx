"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);
gsap.ticker.lagSmoothing(0); // reveals hide content until done: run on wall-clock time

/**
 * Scroll reveals for marketing pages: elements marked data-land fade up once
 * as they enter. Nothing moves when the visitor prefers reduced motion.
 */
export function LandingMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-land]");
        gsap.set(items, { autoAlpha: 0, y: 14 });
        ScrollTrigger.batch(items, {
          start: "top 90%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.07, overwrite: true }),
        });
        // Steps of the lifecycle timeline light up in order.
        const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
        if (steps.length) {
          gsap.from(steps, { opacity: 0.25, duration: 0.4, stagger: 0.18, ease: "none", scrollTrigger: { trigger: steps[0], start: "top 80%", once: true } });
        }
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return <div ref={ref}>{children}</div>;
}
