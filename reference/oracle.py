"""First Floor — reference oracle.

Computes every metric in the v1 report from a structure document and a scenario
document, and emits golden vectors that the TypeScript core must reproduce.

This file is a test oracle, not the shipping implementation. It exists to be run
once, frozen, and retired. Every algorithm here is specified in
COMPUTATIONAL_SPEC.md; where the two disagree, the spec is wrong and should be
corrected — not this file, and not silently.

Determinism: the Monte Carlo uses mulberry32 + Box-Muller with a fixed draw
order so that Python and TypeScript produce bit-identical streams. Do not
substitute numpy's generator.

Every float accumulation goes through math.fsum, which is exactly rounded, and
not through the sum() builtin. This is load-bearing. Python 3.12 changed sum()
to use Neumaier compensated summation, so the same source produced results
differing in the last ulp depending on the interpreter minor version - a
determinism defect under invariant 6. It surfaced when the committed vectors
(generated on 3.12+) failed to reproduce on 3.11. fsum removes the version
dependence and gives the TypeScript port an exactly specified target: a naive
left-to-right loop will NOT reproduce these vectors. See COMPUTATIONAL_SPEC.md
section 0.

Usage:  python3 oracle.py <structure.json> <scenario.json> > golden_vectors.json
"""

import json
import math
import sys
from datetime import date

# ---------------------------------------------------------------- primitives

SQRT2 = math.sqrt(2.0)


def norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / SQRT2)


def norm_ppf(p: float) -> float:
    """Acklam's rational approximation. Absolute error < 1.15e-9."""
    if not 0.0 < p < 1.0:
        raise ValueError("norm_ppf domain")
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    pl, ph = 0.02425, 1 - 0.02425
    if p < pl:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > ph:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def bs(S, K, T, r, q, sigma, right):
    """Black-Scholes with continuous dividend yield. T in years."""
    if T <= 0 or sigma <= 0:
        return max(0.0, (S - K) if right == "call" else (K - S))
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v
    d2 = d1 - v
    if right == "call":
        return S * math.exp(-q * T) * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)
    return K * math.exp(-r * T) * norm_cdf(-d2) - S * math.exp(-q * T) * norm_cdf(-d1)


def bs_delta(S, K, T, r, q, sigma, right):
    if T <= 0 or sigma <= 0:
        itm = (S > K) if right == "call" else (S < K)
        return (1.0 if right == "call" else -1.0) if itm else 0.0
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v
    return math.exp(-q * T) * (norm_cdf(d1) if right == "call" else norm_cdf(d1) - 1.0)


def implied_vol(price, S, K, T, r, q, right, lo=1e-4, hi=5.0, iters=200):
    """Bisection. Monotone in sigma, so no convergence pathology."""
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if bs(S, K, T, r, q, mid, right) > price:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def strike_for_call_delta(S, T, r, q, sigma, target):
    d1 = norm_ppf(min(max(target * math.exp(q * T), 1e-9), 1 - 1e-9))
    return S * math.exp((r - q + 0.5 * sigma * sigma) * T - d1 * sigma * math.sqrt(T))


class Mulberry32:
    """Seeded PRNG. Must match the TypeScript implementation exactly."""

    def __init__(self, seed: int):
        self.a = seed & 0xFFFFFFFF

    def next_uniform(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = (t ^ (t >> 15)) * (1 | t) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def next_normal(self) -> float:
        u1 = max(self.next_uniform(), 1e-12)
        u2 = self.next_uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


# ---------------------------------------------------------------- model load

class Structure:
    def __init__(self, doc):
        self.doc = doc
        self.as_of = date.fromisoformat(doc["as_of"])
        self.und = doc["underlyings"]
        self.ref_id = doc["reference_id"]
        self.nav = doc["capital"]["net_assets"]
        self.cash_w = doc["capital"].get("cash_weight", 0.0)
        self.fee = doc["capital"].get("expense_ratio", 0.0)
        self.w_eq = doc["held_asset"]["weight"]
        self.kind = doc["held_asset"]["kind"]
        m = doc.get("market", {})
        self.r = m.get("risk_free_rate", 0.04)
        self.legs = []
        for l in doc["option_legs"]:
            u = self.und[l["underlying_id"]]
            T = (date.fromisoformat(l["expiry"]) - self.as_of).days / 365.0
            units = l["contracts"] * l.get("multiplier", 100)
            sig = l.get("implied_vol")
            if sig is None and l.get("mark_per_unit") is not None and T > 0:
                sig = implied_vol(l["mark_per_unit"], u["level"], l["strike"], T,
                                  self.r, u.get("dividend_yield", 0.0), l["right"])
            self.legs.append({
                "id": l["leg_id"], "right": l["right"], "sign": 1 if l["position"] == "long" else -1,
                "K": l["strike"], "T": T, "units": units, "S0": u["level"],
                "q": u.get("dividend_yield", 0.0), "iv": sig,
                "mark": l.get("mark_per_unit"), "u": l["underlying_id"],
                "ratio": u.get("ratio_to_reference", 1.0),
            })

    def ref_level(self):
        return self.und[self.ref_id]["level"]

    def puts(self):
        return [l for l in self.legs if l["right"] == "put" and l["sign"] > 0]

    def short_calls(self):
        return [l for l in self.legs if l["right"] == "call" and l["sign"] < 0]

    def synthetic_longs(self):
        ref = self.ref_level()
        return [l for l in self.legs
                if l["right"] == "call" and l["sign"] > 0 and l["K"] < 0.05 * ref * l["ratio"]]


# ------------------------------------------------------------ classification

def classify(s: Structure):
    n_names = len(s.doc["held_asset"].get("constituents", []) or [])
    if s.synthetic_longs():
        arch = "synthetic"
    elif s.kind == "reference_tracking_fund" or (0 < n_names <= 2):
        arch = "reference_tracking"
    elif s.kind == "basket" or n_names >= 3:
        arch = "basket"
    else:
        arch = "unclassified"
    short_puts = [l for l in s.legs if l["right"] == "put" and l["sign"] < 0]
    protection = "put_spread" if short_puts else ("plain_put" if s.puts() else "none")
    put_exp = sorted({l["T"] for l in s.puts()})
    call_exp = sorted({l["T"] for l in s.short_calls()})
    floor_life = math.fsum(l["T"] for l in s.puts()) / len(s.puts()) * 365 if s.puts() else None
    cap_life = math.fsum(l["T"] for l in s.short_calls()) / len(s.short_calls()) * 365 if s.short_calls() else None
    return {
        "architecture": arch,
        "protection_kind": protection,
        "basis_live": arch == "basket",
        "protection_continues_below_lowest_strike": protection == "plain_put",
        "floor_tranches": len(s.puts()),
        "cap_tranches": len(s.short_calls()),
        "distinct_floor_expiries": len(put_exp),
        "distinct_cap_expiries": len(call_exp),
        "mean_floor_remaining_days": floor_life,
        "mean_cap_remaining_days": cap_life,
        "reset_asymmetry_ratio": (floor_life / cap_life) if (floor_life and cap_life) else None,
    }


# ---------------------------------------------------------------- exposure

def exposure(s: Structure):
    nav = s.nav
    put_spot = math.fsum(l["units"] * l["S0"] for l in s.puts()) / nav
    put_strike = math.fsum(l["units"] * l["K"] for l in s.puts()) / nav
    call_spot = math.fsum(l["units"] * l["S0"] for l in s.short_calls()) / nav
    have_marks = all(l["mark"] is not None for l in s.legs)
    book = (math.fsum(l["sign"] * l["units"] * l["mark"] for l in s.legs) / nav
            if have_marks else None)
    gross = math.fsum(l["units"] * l["S0"] for l in s.legs) / nav
    # delta cancellation ratio, evaluated in the puts' own underlying units
    lam = None
    if s.puts() and s.w_eq > 0:
        S0 = s.puts()[0]["S0"]
        lam = (math.fsum(l["units"] for l in s.puts()) / nav) * S0 / s.w_eq
    attach = None
    if s.puts():
        S0 = s.puts()[0]["S0"]
        attach = math.fsum(l["K"] for l in s.puts()) / len(s.puts()) / S0 - 1.0
    lowest = None
    if s.puts():
        S0 = s.puts()[0]["S0"]
        lowest = min(l["K"] for l in s.puts()) / S0 - 1.0
    net_delta = s.w_eq * 1.0 + math.fsum(
        l["sign"] * l["units"] * bs_delta(l["S0"], l["K"], l["T"], s.r, l["q"],
                                         l["iv"] or 0.2, l["right"]) * l["S0"] / nav
        for l in s.legs)
    return {
        "held_asset_weight": s.w_eq,
        "cash_weight": s.cash_w,
        "put_spot_notional": put_spot,
        "insured_value": put_strike,
        "short_call_spot_notional": call_spot,
        "gross_option_notional": gross,
        "option_book_value": book,
        "weights_reconcile": (s.w_eq + book + s.cash_w) if have_marks else None,
        "weights_reconcile_blocked_by": None if have_marks else "one or more legs have no mark",
        "delta_cancellation_ratio": lam,
        "average_attachment": attach,
        "lowest_attachment": lowest,
        "net_delta": net_delta,
    }


# ------------------------------------------------------------ payoff geometry

def terminal_value(s: Structure, drop, beta_d=1.0, beta_u=1.0):
    """Fund value at expiry as a multiple of today's NAV, reference move = drop."""
    b = beta_d if drop <= 0 else beta_u
    val = s.w_eq * (1.0 + b * drop) + s.cash_w
    for l in s.legs:
        S = l["S0"] * (1.0 + drop)
        intr = max(0.0, (S - l["K"]) if l["right"] == "call" else (l["K"] - S))
        val += l["sign"] * l["units"] * intr / s.nav
    return val - 1.0


def terminal_floor(s: Structure, beta_d=1.0, lo=-0.95, steps=1901, tol=5e-4):
    """Minimum terminal value over a grid of reference moves.

    Where the payoff is flat below the ladder the minimum is attained over an
    interval, so report the SHALLOWEST move that attains it — the point at which
    further decline stops mattering. Reporting the scan edge instead would
    misleadingly imply the floor only binds at -95%.
    """
    grid = [lo + i * (-lo) / (steps - 1) for i in range(steps)]
    vals = [(terminal_value(s, d, beta_d), d) for d in grid]
    vmin = min(v for v, _ in vals)
    within = [d for v, d in vals if v <= vmin + tol]
    shallowest = max(within)
    # "Flat" means flat to the stated tolerance over a wide interval, not
    # exactly flat. A ladder sized to Lambda != 1 leaves a residual slope that
    # is invisible at 5bp but compounds over a deep decline.
    return {"value": vmin, "at_reference_move": shallowest,
            "flat_below": len(within) > 1, "flat_tolerance": tol}


def mtm_value(s: Structure, drop, vol_beta):
    val = s.w_eq * (1.0 + drop) + s.cash_w
    for l in s.legs:
        S = l["S0"] * (1.0 + drop)
        sig = max(0.02, (l["iv"] or 0.2) + vol_beta * max(0.0, -drop))
        val += l["sign"] * l["units"] * bs(S, l["K"], l["T"], s.r, l["q"], sig, l["right"]) / s.nav
    return val - 1.0


def gradual_decline(s: Structure, total_move, horizon_days, repl, include_calls=False):
    """Path where the reference moves monotonically to total_move over the horizon.

    Expiring floor tranches are replaced at repl['floor_strike_pct_of_spot'] of
    the then-current level, funded from cash. A monotone path is the best case
    for a call writer, so the call overlay is excluded by default and its
    inclusion is reported.
    """
    if not s.puts():
        return None
    S0 = s.puts()[0]["S0"]
    live = [{"K": l["K"], "T_days": l["T"] * 365, "units": l["units"]} for l in s.puts()]
    pct = repl.get("floor_strike_pct_of_spot", 0.90)
    tenor = repl.get("floor_tenor_days", 365)
    riv = repl.get("floor_iv", 0.25)
    eq = s.w_eq
    cash = s.cash_w
    S = S0
    for day in range(1, horizon_days + 1):
        Snew = S0 * (1.0 + total_move) ** (day / horizon_days)
        eq *= Snew / S
        S = Snew
        for p in live:
            if abs(p["T_days"] - day) < 0.5:
                cash += p["units"] * max(0.0, p["K"] - S) / s.nav
                p["K"] = pct * S
                p["T_days"] = day + tenor
                cash -= p["units"] * bs(S, p["K"], tenor / 365.0, s.r, 0.0, riv, "put") / s.nav
    resid = math.fsum(p["units"] * bs(S, p["K"], max(0.0, p["T_days"] - horizon_days) / 365.0,
                                s.r, 0.0, riv, "put") / s.nav for p in live)
    val = eq + cash + resid - s.fee * horizon_days / 365.0
    return {"outcome": val - 1.0, "include_call_overlay": include_calls,
            "note": "monotone path; call overlay excluded" if not include_calls else "monotone path"}


# ---------------------------------------------------------------- capture

def capture(s: Structure, tenor_days, delta, horizon_days, ref_move, ref_vol,
            paths, seed, overwrite=None, band=0.02):
    if overwrite is None:
        overwrite = exposure(s)["short_call_spot_notional"] or 0.0
    r, q = s.r, s.und[s.ref_id].get("dividend_yield", 0.0)
    steps = max(1, round(horizon_days / tenor_days))
    dt = horizon_days / steps / 365.0
    mu = math.log(1.0 + ref_move) / (horizon_days / 365.0)
    rng = Mulberry32(seed)
    S = [1.0] * paths
    nav = [1.0] * paths
    for _ in range(steps):
        for i in range(paths):
            K = strike_for_call_delta(S[i], dt, r, q, ref_vol, delta)
            prem = bs(S[i], K, dt, r, q, ref_vol, "call")
            z = rng.next_normal()
            S2 = S[i] * math.exp((mu - 0.5 * ref_vol ** 2) * dt + ref_vol * math.sqrt(dt) * z)
            ret = (S2 / S[i] - 1.0) + overwrite * (prem * math.exp(r * dt) - max(0.0, S2 - K)) / S[i]
            nav[i] *= (1.0 + ret)
            S[i] = S2
    sel = [i for i in range(paths) if abs((S[i] - 1.0) - ref_move) < band]
    if len(sel) < 50:
        return {"capture": None, "conditioned_paths": len(sel)}
    mn = math.fsum(nav[i] - 1.0 for i in sel) / len(sel)
    mi = math.fsum(S[i] - 1.0 for i in sel) / len(sel)
    return {"capture": mn / mi, "conditioned_paths": len(sel)}


# ---------------------------------------------------------------- sleeve

def concentration(s: Structure):
    cons = s.doc["held_asset"].get("constituents") or []
    if not cons:
        return None
    tot = math.fsum(c["weight"] for c in cons)
    ws = [c["weight"] / tot for c in cons]
    hhi = math.fsum(w * w for w in ws)
    return {"names": len(cons), "hhi": hhi, "effective_n": 1.0 / hhi,
            "top_weight": max(ws), "weights_sum_raw": tot}


# ---------------------------------------------------------------- assemble

def run(structure_doc, scenario_doc):
    s = Structure(structure_doc)
    sc = scenario_doc
    vb = sc.get("vol_beta", 0.65)
    resp = sc.get("held_asset_response", {})
    bd = resp.get("beta_down", s.doc["held_asset"].get("response", {}).get("beta_down", 1.0))
    bu = resp.get("beta_up", s.doc["held_asset"].get("response", {}).get("beta_up", 1.0))

    out = {
        "as_of": structure_doc["as_of"],
        "classification": classify(s),
        "exposure": exposure(s),
        "implied_vols": {l["id"]: l["iv"] for l in s.legs},
        "terminal_floor": terminal_floor(s, bd),
        "terminal_by_beta": {},
        "mtm_by_vol_beta": {},
        "concentration": concentration(s),
    }

    for b in (1.00, 1.10, 1.20):
        out["terminal_by_beta"][f"{b:.2f}"] = {
            f"{d:+.2f}": terminal_value(s, d, b) for d in (-0.20, -0.40, -0.60)}

    for v in (0.0, 0.35, 0.65, 1.0):
        out["mtm_by_vol_beta"][f"{v:.2f}"] = {
            f"{d:+.2f}": mtm_value(s, d, v) for d in (-0.10, -0.20, -0.30)}

    dec = sc.get("decline")
    if dec:
        out["gradual_decline"] = gradual_decline(
            s, dec.get("total_move", -0.30), dec.get("horizon_days", 365),
            dec.get("replacement", {}), dec.get("include_call_overlay", False))

    cap = sc.get("capture")
    if cap:
        grid = {}
        for t in cap.get("tenor_grid_days", [14, 30, 91]):
            for d in cap.get("delta_grid", [0.30, 0.25, 0.20]):
                grid[f"{t}d_{d:.2f}"] = capture(
                    s, t, d, cap.get("horizon_days", 91), cap.get("reference_move", 0.152),
                    cap.get("reference_vol", 0.16), cap.get("paths", 20000), cap.get("seed", 11))
        out["capture_grid"] = grid
        out["capture_params"] = {k: cap.get(k) for k in
                                 ("horizon_days", "reference_move", "reference_vol", "paths", "seed")}

    out["scenario"] = {"vol_beta": vb, "beta_down": bd, "beta_up": bu}
    return out


if __name__ == "__main__":
    structure = json.load(open(sys.argv[1]))
    scenario = json.load(open(sys.argv[2]))
    print(json.dumps(run(structure, scenario), indent=2))
