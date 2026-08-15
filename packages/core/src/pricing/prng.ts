// SPDX-License-Identifier: MIT

/**
 * Seeded PRNG — mulberry32 plus Box-Muller. Spec section 1.7.
 *
 * Cross-language agreement is the whole point of specifying an exact algorithm,
 * and the brief warns that Phase 6 fails here first. Two things make the port
 * non-obvious:
 *
 * 1. Python's `& 0xFFFFFFFF` operates on arbitrary-precision integers, so its
 *    products are exact before truncation. JavaScript's `*` on two 32-bit
 *    values can exceed 53 bits and silently drop low bits, which changes the
 *    stream. Every multiply here goes through `Math.imul`, which computes the
 *    product modulo 2^32 the way C would.
 *
 * 2. Operator precedence in the oracle's third line is easy to misread. Python
 *    binds `&` tighter than `^`, so
 *
 *        t = (t + (...)) & 0xFFFFFFFF ^ t
 *
 *    means `((t + (...)) & 0xFFFFFFFF) ^ t`, not `(t + (...)) & (0xFFFFFFFF ^ t)`.
 *
 * `Math.random()` cannot be seeded and numpy's generator will not match. Do not
 * substitute either.
 */
export class Mulberry32 {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** Next uniform in [0, 1). */
  nextUniform(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), 1 | t) >>> 0;
    t = (((t + (Math.imul(t ^ (t >>> 7), 61 | t) >>> 0)) >>> 0) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Next standard normal by Box-Muller, consuming exactly two uniforms and
   * discarding the sine branch.
   *
   * Discarding half the output looks wasteful and is not negotiable: draw order
   * is part of the specification, and keeping the sine branch would halve the
   * uniforms consumed and desynchronise every downstream figure.
   */
  nextNormal(): number {
    const u1 = Math.max(this.nextUniform(), 1e-12);
    const u2 = this.nextUniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
