"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);
gsap.ticker.lagSmoothing(0); // reveals hide content until done: run on wall-clock time

/*
 * Illustrative product preview for the landing page: a drawing of the
 * interface, labelled as such. It does not show measured results.
 */

const DEPLOYED = "M0,150 C60,148 120,151 180,146 C240,141 290,136 330,120 C370,104 400,74 440,62 C480,52 520,55 560,50 C600,46 640,48 680,44";
const PROBE = "M0,154 C60,153 120,155 180,152 C240,149 290,150 330,147 C370,144 400,143 440,142 C480,141 520,143 560,141 C600,140 640,142 680,140";
const BAND = "M0,142 C60,140 120,143 180,138 C240,132 290,126 330,108 C370,90 400,60 440,48 C480,38 520,41 560,36 C600,32 640,34 680,30 L680,58 C640,62 600,60 560,64 C520,69 480,66 440,76 C400,88 370,118 330,132 C290,146 240,150 180,154 C120,159 60,156 0,158 Z";

const NAV = ["Overview", "Data & streams", "Monitoring", "Decisions", "Lifecycle", "Models", "Experiments"];

export function HeroPreview() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ delay: 0.15 });
        tl.from("[data-p='frame']", { y: 60, rotateX: 18, autoAlpha: 0, duration: 1.1, ease: "power3.out" })
          .from("[data-p='metric']", { y: 8, autoAlpha: 0, duration: 0.4, stagger: 0.07 }, "-=0.5")
          .from("[data-p='band']", { autoAlpha: 0, duration: 0.6 }, "-=0.2")
          .fromTo("[data-p='line']", { strokeDashoffset: 900 }, { strokeDashoffset: 0, duration: 1.6, ease: "power1.inOut", stagger: 0.2 }, "<")
          .from("[data-p='marker']", { autoAlpha: 0, y: -6, duration: 0.35, stagger: 0.15 }, "-=0.6")
          .from("[data-p='decision']", { x: 20, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, "-=0.3")
          .from("[data-p='float']", { y: 16, autoAlpha: 0, scale: 0.96, duration: 0.55, stagger: 0.18, ease: "back.out(1.6)" }, "-=0.2");
        // Gentle depth on scroll: the window settles flat, the cards drift.
        gsap.to("[data-p='frame']", { rotateX: 0, scrollTrigger: { trigger: ref.current, start: "top 70%", end: "bottom 30%", scrub: true } });
        gsap.utils.toArray<HTMLElement>("[data-p='float']").forEach((el, i) => {
          gsap.to(el, { y: i % 2 ? -40 : -24, ease: "none", scrollTrigger: { trigger: ref.current, start: "top bottom", end: "bottom top", scrub: true } });
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="relative mx-auto max-w-[1080px] [perspective:1600px]" role="img" aria-label="Illustration of the RetrainWise interface: model health, a rising error line against a flat probe line, and a recommendation awaiting approval">
      <div data-p="frame" className="relative overflow-hidden rounded-xl border border-border bg-background shadow-[0_50px_120px_-50px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.02)] [transform-origin:50%_0%] [transform:rotateX(8deg)]">
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-border bg-subtle px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#e5e5e2]" />
            <span className="size-2.5 rounded-full bg-[#e5e5e2]" />
            <span className="size-2.5 rounded-full bg-[#e5e5e2]" />
          </div>
          <div className="mx-auto hidden h-6 w-72 items-center justify-center rounded-md border border-border bg-background text-[11px] text-muted-foreground sm:flex">localhost:3000/overview</div>
          <span className="text-[10.5px] text-muted-foreground">Illustration</span>
        </div>
        <div className="grid md:grid-cols-[170px_1fr_240px]">
          {/* sidebar */}
          <aside className="hidden border-r border-border p-4 md:block" aria-hidden>
            <div className="font-serif text-[18px] leading-none">RetrainWise</div>
            <div className="mt-4 rounded-md border border-border px-2 py-1.5 text-[11px]">
              Fraud models
              <div className="text-[10px] text-muted-foreground">Approver</div>
            </div>
            <ul className="mt-4 space-y-0.5 text-[11.5px]">
              {NAV.map((n, i) => (
                <li key={n} className={i === 0 ? "relative rounded bg-muted px-2 py-1 font-medium" : "px-2 py-1 text-muted-foreground"}>
                  {i === 0 && <span className="absolute inset-y-1 left-0 w-0.5 bg-foreground" />}
                  {n}
                </li>
              ))}
            </ul>
          </aside>
          {/* main */}
          <div className="p-5 sm:p-6">
            <div className="font-serif text-[30px] leading-none">Model health</div>
            <p className="mt-2 text-[12px] text-muted-foreground">Error is rising, and a freshly trained probe does not rise with it.</p>
            <div className="mt-5 grid grid-cols-2 border-y border-border text-[11px] sm:grid-cols-4">
              {[
                ["Model version", "v004", ""],
                ["Rolling error", "rising", "text-bad"],
                ["Staleness", "avoidable", "text-bad"],
                ["Budget remaining", "within limit", ""],
              ].map(([k, val, tone]) => (
                <div key={k} data-p="metric" className="py-3 pr-2">
                  <div className="text-muted-foreground">{k}</div>
                  <div className={`mt-1 text-[15px] font-medium ${tone}`}>{val}</div>
                </div>
              ))}
            </div>
            <svg viewBox="0 0 680 180" className="mt-5 h-44 w-full" aria-hidden>
              {[40, 90, 140].map((y) => (
                <line key={y} x1="0" x2="680" y1={y} y2={y} stroke="#ededeb" />
              ))}
              <path data-p="band" d={BAND} fill="#f0f0ee" />
              <g data-p="marker">
                <line x1="330" x2="330" y1="8" y2="175" stroke="#a15c00" strokeDasharray="3 3" />
                <text x="336" y="18" fontSize="10" fill="#a15c00">
                  drift alarm
                </text>
              </g>
              <g data-p="marker">
                <line x1="560" x2="560" y1="50" y2="141" stroke="#c62828" strokeWidth="1.2" />
                <text x="566" y="100" fontSize="10" fill="#c62828">
                  avoidable error
                </text>
              </g>
              <path data-p="line" d={PROBE} fill="none" stroke="#8a8a87" strokeWidth="1.6" strokeDasharray="900" strokeDashoffset="0" />
              <path data-p="line" d={DEPLOYED} fill="none" stroke="#0a0a0a" strokeWidth="2.2" strokeDasharray="900" strokeDashoffset="0" />
            </svg>
            <div className="mt-1 flex gap-5 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-foreground" /> deployed model
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-[#8a8a87]" /> fresh probe
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 bg-[#f0f0ee]" /> 95% interval
              </span>
            </div>
          </div>
          {/* decision panel */}
          <div data-p="decision" className="border-t border-border bg-subtle p-5 md:border-l md:border-t-0">
            <div className="text-[11px] text-muted-foreground">Recommendation</div>
            <div className="mt-1 font-serif text-[22px] leading-tight">Partial update</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[10.5px]">
              {["Keep", "Partial", "Full"].map((a, i) => (
                <div key={a} className={`border-l-2 pl-1.5 ${i === 1 ? "border-foreground font-medium" : "border-border text-muted-foreground"}`}>
                  {a}
                  <div className="font-normal text-muted-foreground">{i === 0 ? "reference" : i === 1 ? "best value" : "over budget"}</div>
                </div>
              ))}
            </div>
            <ul className="mt-4 space-y-1.5 text-[11px]">
              {["Benefit exceeds cost", "Validation on later rows", "Within budget", "Cooldown respected"].map((g) => (
                <li key={g} className="flex items-center gap-1.5">
                  <span className="text-ok">✓</span> {g}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex h-8 items-center justify-center rounded-md bg-foreground text-[12px] font-medium text-background">Request approval</div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">An approver decides. Nothing ships automatically.</p>
          </div>
        </div>
      </div>

      {/* floating annotation cards */}
      <div data-p="float" className="absolute -left-6 top-[42%] hidden w-56 rounded-lg border border-border bg-background/95 p-3.5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] backdrop-blur lg:block">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="animate-pulse-dot size-1.5 rounded-full bg-ok" /> Probe ran · value of information &gt; cost
        </div>
        <div className="mt-1.5 text-[13px] font-medium">Deployed and probe diverged</div>
        <div className="mt-0.5 text-[11.5px] text-ink-2">The gap grew beyond the gap at deployment.</div>
      </div>
      <div data-p="float" className="absolute -right-6 bottom-10 hidden w-60 rounded-lg border border-border bg-background/95 p-3.5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] backdrop-blur lg:block">
        <div className="text-[11px] text-muted-foreground">Audit trail</div>
        <ol className="mt-1.5 space-y-1 text-[11.5px]">
          <li>Operator requested a partial update</li>
          <li>Approver approved after validation</li>
          <li className="font-medium">v005 promoted</li>
        </ol>
      </div>
    </div>
  );
}
