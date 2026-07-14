#!/usr/bin/env python3
"""BET-5 vector benchmark: pgvector+HNSW vs Qdrant on 768-dim cosine k-NN.
Synthetic random-on-sphere vectors (hardest case for ANN → conservative recall).
Measures: load time, index build, query latency p50/p95, recall@k vs exact."""
import os, time, json, urllib.request
import numpy as np
import psycopg2
from psycopg2.extras import execute_values

N = int(os.environ.get("N", "50000"))
Q = int(os.environ.get("Q", "200"))
K = int(os.environ.get("K", "10"))
DIM = 768
QDRANT = os.environ.get("QDRANT_URL", "http://dpf-qdrant-1:6333")
COLL = "bet5_bench"
PG = dict(host="bet5-pgvector", dbname="bench", user="bench", password="bench")

def qreq(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(QDRANT + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def pct(xs, p): return sorted(xs)[min(len(xs)-1, int(len(xs)*p))]

LATENT = int(os.environ.get("LATENT", "48"))     # intrinsic manifold dim (real text embeds are low-rank)
NOISE = float(os.environ.get("NOISE", "0.05"))    # ambient noise off the manifold
EFS = [int(x) for x in os.environ.get("EFS", "40,100,200").split(",")]
print(f"== BET-5 vector A/B :: N={N} Q={Q} K={K} dim={DIM} latent={LATENT} noise={NOISE} (low-rank manifold ~ real embeddings) ==", flush=True)
rng = np.random.default_rng(42)
# Real text embeddings (nomic-768) live on a LOW-DIMENSIONAL manifold: semantic content is
# ~intrinsic-dim LATENT, linearly embedded in 768-dim, with small off-manifold noise. This is
# what lets ANN work (published pgvector/Qdrant benchmarks hit 0.95+ recall on real data);
# 768-dim isotropic noise or fat Gaussian blobs are NOT representative.
proj = rng.standard_normal((LATENT, DIM)).astype(np.float32)
def make(n):
    z = rng.standard_normal((n, LATENT)).astype(np.float32)
    x = z @ proj + NOISE * rng.standard_normal((n, DIM)).astype(np.float32)
    x /= np.linalg.norm(x, axis=1, keepdims=True)
    return x
base = make(N)
qs = make(Q)

# exact ground truth (cosine == dot on normalized)
t = time.time()
sims = qs @ base.T
exact = np.argsort(-sims, axis=1)[:, :K]
print(f"exact ground-truth top-{K} computed in {time.time()-t:.1f}s", flush=True)

# ---- pgvector ----
conn = psycopg2.connect(**PG); conn.autocommit = True; cur = conn.cursor()
cur.execute("DROP TABLE IF EXISTS bench_vec")
cur.execute(f"CREATE TABLE bench_vec (id int primary key, emb vector({DIM}))")
t = time.time()
rows = [(i, "[" + ",".join(f"{x:.6f}" for x in base[i]) + "]") for i in range(N)]
execute_values(cur, "INSERT INTO bench_vec (id, emb) VALUES %s", rows, page_size=2000)
pg_insert = time.time()-t
t = time.time()
cur.execute("CREATE INDEX ON bench_vec USING hnsw (emb vector_cosine_ops) WITH (m=16, ef_construction=64)")
pg_build = time.time()-t
pg_qvecs = ["[" + ",".join(f"{x:.6f}" for x in qs[i]) + "]" for i in range(Q)]
pg_res = {}
for ef in EFS:
    cur.execute(f"SET hnsw.ef_search = {ef}")
    lat, hits = [], 0
    for i in range(Q):
        t = time.time()
        cur.execute("SELECT id FROM bench_vec ORDER BY emb <=> %s LIMIT %s", (pg_qvecs[i], K))
        got = [r[0] for r in cur.fetchall()]
        lat.append((time.time()-t)*1000)
        hits += len(set(got) & set(exact[i].tolist()))
    pg_res[ef] = (hits/(Q*K), pct(lat,0.5), pct(lat,0.95))

# ---- Qdrant ----
try: qreq(f"/collections/{COLL}", "DELETE")
except Exception: pass  # best-effort: benchmark collection may not exist yet
qreq(f"/collections/{COLL}", "PUT", {"vectors": {"size": DIM, "distance": "Cosine"},
      "hnsw_config": {"m": 16, "ef_construct": 64}})
t = time.time()
B = 1000
for s in range(0, N, B):
    pts = [{"id": i, "vector": base[i].tolist()} for i in range(s, min(s+B, N))]
    qreq(f"/collections/{COLL}/points?wait=true", "PUT", {"points": pts})
qd_insert = time.time()-t
qlists = [qs[i].tolist() for i in range(Q)]
qd_res = {}
for ef in EFS:
    lat, hits = [], 0
    for i in range(Q):
        t = time.time()
        r = qreq(f"/collections/{COLL}/points/search", "POST",
                 {"vector": qlists[i], "limit": K, "params": {"hnsw_ef": ef}})
        got = [p["id"] for p in r["result"]]
        lat.append((time.time()-t)*1000)
        hits += len(set(got) & set(exact[i].tolist()))
    qd_res[ef] = (hits/(Q*K), pct(lat,0.5), pct(lat,0.95))
try: qreq(f"/collections/{COLL}", "DELETE")
except Exception: pass  # best-effort cleanup: ignore if already deleted

print("\n===================== RESULTS =====================", flush=True)
print(f"insert {N} vecs:  pgvector {pg_insert:.1f}s   Qdrant {qd_insert:.1f}s")
print(f"pgvector HNSW index build: {pg_build:.1f}s   (Qdrant builds inline on upsert)")
print(f"\n{'ef_search':<10}{'pg recall':>10}{'pg p50ms':>10}{'pg p95ms':>10}{'  ':>4}{'qd recall':>10}{'qd p50ms':>10}{'qd p95ms':>10}")
for ef in EFS:
    pr,p50,p95 = pg_res[ef]; qr,q50,q95 = qd_res[ef]
    print(f"{ef:<10}{pr:>10.3f}{p50:>10.2f}{p95:>10.2f}{'  ':>4}{qr:>10.3f}{q50:>10.2f}{q95:>10.2f}")
print("===================================================", flush=True)
print(json.dumps({"N":N,"Q":Q,"K":K,"latent":LATENT,"noise":NOISE,
                  "pg":{ef:pg_res[ef] for ef in EFS},"qd":{ef:qd_res[ef] for ef in EFS},
                  "insert_s":{"pg":pg_insert,"qd":qd_insert},"pg_build_s":pg_build}))
