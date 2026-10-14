/** Small seeded PRNG (xoshiro128**) with uniform, normal and categorical draws.
 * Deterministic for a given seed across platforms; not cryptographic. */
export class Rng {
  private s: Uint32Array;
  private spare: number | null = null;

  constructor(seed: number) {
    // splitmix32 expands one integer into four non-zero state words
    let x = (Math.floor(Math.abs(seed)) % 4294967296) >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s = new Uint32Array([next(), next(), next(), next()]);
    if (this.s.every((v) => v === 0)) this.s[0] = 1;
  }

  private nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform in [0, 1) with 53 bits of precision. */
  random(): number {
    const hi = this.nextU32() >>> 5;
    const lo = this.nextU32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Standard normal (Marsaglia polar method). */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + sd * v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.random() * 2 - 1;
      v = this.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mean + sd * u * m;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }

  choice<T>(items: readonly T[], probabilities: readonly number[]): T {
    let r = this.random();
    for (let i = 0; i < items.length; i++) {
      r -= probabilities[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[] | Int32Array | Uint32Array): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
