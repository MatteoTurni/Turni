#!/usr/bin/env python3
# Confronto A/B fra due sweep dell'harness (JSON prodotti da sim.ts).
import json, sys, statistics as st
A = json.load(open(sys.argv[1]))  # baseline
B = json.load(open(sys.argv[2]))  # variante
KEYS = ["ms","buchi","wkDef","wkScarto","sforo","transMean","lavIsolati","libIsolati","strisceM","wkLibMin"]
def agg(rows):
    out={}
    for k in KEYS: out[k]=st.mean(r[k] for r in rows)
    out["viol"]=sum(len(r["viol"]) for r in rows)
    out["ok"]=sum(1 for r in rows if r["ok"])
    # spread notti: max-min per run, media
    out["nottiSpread"]=st.mean(max(r["notti"].values())-min(v for v in r["notti"].values()) for r in rows)
    return out
scen = sorted(set(r["scen"] for r in A))
print(f"{'scenario':<15} {'metr':<9} {'base':>8} {'var':>8} {'delta':>8}")
tot_delta = {}
for s in scen:
    a=agg([r for r in A if r["scen"]==s]); b=agg([r for r in B if r["scen"]==s])
    for k in ["viol","ok","buchi","wkDef","wkScarto","sforo","wkLibMin","nottiSpread","transMean","lavIsolati","libIsolati","strisceM","ms"]:
        d=b[k]-a[k]
        tot_delta.setdefault(k,[]).append(d)
        flag=""
        if k in ("viol","buchi","wkDef","wkScarto","sforo","nottiSpread") and d>0.05: flag=" <<< PEGGIO"
        if k in ("ok","wkLibMin") and d<-0.05: flag=" <<< PEGGIO"
        if abs(d)>0.05 or flag:
            print(f"{s:<15} {k:<9} {a[k]:>8.2f} {b[k]:>8.2f} {d:>+8.2f}{flag}")
print("\n── MEDIA DELTA PER METRICA (variante − baseline) ──")
for k,v in tot_delta.items():
    print(f"{k:<12} {st.mean(v):+8.3f}")
