#!/usr/bin/env python3
"""BET-5 A/B parity gate: pgvector-store vs live Qdrant on the REAL wiki-pages corpus.
Extracts the live Qdrant collection, loads it into pgvector exactly as the migration + store do,
then runs identical top-k searches (ranking + payload-filter) through both and asserts parity."""
import json, urllib.request
import psycopg2
from psycopg2.extras import execute_values

QDRANT = "http://dpf-qdrant-1:6333"
COLL = "wiki-pages"
PG = dict(host="bet5-pgab", dbname="ab", user="ab", password="ab")
K = 5

def qreq(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(QDRANT + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

# 1) Extract all points from live Qdrant (id, vector, payload)
pts, offset = [], None
while True:
    body = {"limit": 200, "with_vector": True, "with_payload": True}
    if offset is not None:
        body["offset"] = offset
    res = qreq(f"/collections/{COLL}/points/scroll", "POST", body)["result"]
    pts.extend(res["points"])
    offset = res.get("next_page_offset")
    if offset is None:
        break
print(f"extracted {len(pts)} points from live Qdrant {COLL}")

# 2) Load into pgvector exactly as the migration + store define
c = psycopg2.connect(**PG); c.autocommit = True; cur = c.cursor()
cur.execute("DROP TABLE IF EXISTS vector_embedding")
cur.execute("""CREATE TABLE vector_embedding (collection text NOT NULL, point_id bigint NOT NULL,
  embedding vector(768) NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (collection, point_id))""")
cur.execute("CREATE INDEX ON vector_embedding USING hnsw (embedding vector_cosine_ops) WHERE collection = 'wiki-pages'")
cur.execute("CREATE INDEX ON vector_embedding USING gin (payload)")
rows = [(COLL, p["id"], "[" + ",".join(map(str, p["vector"])) + "]", json.dumps(p["payload"])) for p in pts]
execute_values(cur, "INSERT INTO vector_embedding (collection, point_id, embedding, payload) VALUES %s",
               rows, template="(%s,%s,%s::vector,%s::jsonb)", page_size=200)
print(f"loaded {len(rows)} into pgvector")

# 3) The store's searchSimilar SQL (verbatim shape) — no threshold, pure ranking parity
def pg_search(vec, k, filter_sql="", params=()):
    vlit = "[" + ",".join(map(str, vec)) + "]"
    cur.execute(f"""SELECT point_id FROM vector_embedding
        WHERE collection = %s {filter_sql}
        ORDER BY embedding <=> %s::vector LIMIT {k}""", (COLL, *params, vlit))
    return [r[0] for r in cur.fetchall()]

def qd_search(vec, k, flt=None):
    body = {"vector": vec, "limit": k, "with_payload": False}
    if flt: body["filter"] = flt
    return [p["id"] for p in qreq(f"/collections/{COLL}/points/search", "POST", body)["result"]]

# 4a) RANKING parity — every point queried against the corpus
overlap = 0
for p in pts:
    pg = set(pg_search(p["vector"], K))
    qd = set(qd_search(p["vector"], K))
    overlap += len(pg & qd)
rank_parity = overlap / (len(pts) * K)

# 4b) FILTER parity — pick a real payload key and value present in the corpus
keycount = {}
for p in pts:
    for kk, vv in p["payload"].items():
        if isinstance(vv, (str, bool)):
            keycount[(kk, str(vv))] = keycount.get((kk, str(vv)), 0) + 1
(fk, fv), _ = sorted(keycount.items(), key=lambda x: -x[1])[0]
# raw value (not str-coerced) for the filter
fval = next(p["payload"][fk] for p in pts if str(p["payload"].get(fk)) == fv)
q = pts[0]["vector"]
pg_f = set(pg_search(q, 50,
    "AND (payload->%s = %s::jsonb OR payload->%s @> %s::jsonb)",
    (fk, json.dumps(fval), fk, json.dumps(fval))))
qd_f = set(qd_search(q, 50, {"must": [{"key": fk, "match": {"value": fval}}]}))

print("\n===================== A/B PARITY =====================")
print(f"corpus: {len(pts)} real wiki-page vectors (768-dim)")
print(f"RANKING parity  (top-{K} id overlap, {len(pts)} queries): {rank_parity:.3f}")
print(f"FILTER  parity  (must {fk}={fv!r}):  pgvector={len(pg_f)}  qdrant={len(qd_f)}  identical={pg_f == qd_f}")
print("=====================================================")
print(json.dumps({"n": len(pts), "ranking_parity": rank_parity,
                  "filter_key": fk, "filter_pg": len(pg_f), "filter_qd": len(qd_f),
                  "filter_identical": pg_f == qd_f}))
