#!/usr/bin/env python3
"""BET-5 graph A/B: recursive-CTE traversals vs live Neo4j on the REAL code-graph/EA graph.
Extracts Neo4j → graph_node/graph_edge in Postgres, then compares downstream-impact + neighbours."""
import json
import psycopg2
from psycopg2.extras import execute_values
from neo4j import GraphDatabase

IMPACT = ["DEPENDS_ON","HOSTS","RUNS_ON","LISTENS_ON","MONITORS","MEMBER_OF",
          "ROUTES_THROUGH","CARRIED_BY","CONNECTS_TO","PEER_OF"]
PG = dict(host="bet5-pggraph", dbname="g", user="g", password="g")
with open("/neopw.txt") as _pw:
    NEO_PW = _pw.read().strip()
KEY = "coalesce(n.productId, n.ciId, n.nodeId, n.slug)"

drv = GraphDatabase.driver("bolt://dpf-neo4j-1:7687", auth=("neo4j", NEO_PW))
with drv.session() as s:
    nodes = list(s.run(f"MATCH (n) WITH n, {KEY} AS k WHERE k IS NOT NULL "
                       "RETURN k AS key, labels(n) AS labels, properties(n) AS props"))
    edges = list(s.run(
        "MATCH (a)-[r]->(b) WITH a,r,b, coalesce(a.productId,a.ciId,a.nodeId,a.slug) AS sk, "
        "coalesce(b.productId,b.ciId,b.nodeId,b.slug) AS dk WHERE sk IS NOT NULL AND dk IS NOT NULL "
        "RETURN sk AS src, dk AS dst, type(r) AS rel"))
print(f"extracted {len(nodes)} nodes, {len(edges)} edges from live Neo4j")

c = psycopg2.connect(**PG); c.autocommit = True; cur = c.cursor()
cur.execute("DROP TABLE IF EXISTS graph_node; DROP TABLE IF EXISTS graph_edge")
cur.execute("CREATE TABLE graph_node (key text primary key, labels text[], props jsonb)")
cur.execute("CREATE TABLE graph_edge (src_key text, dst_key text, rel_type text)")
# dedup nodes by key (Neo4j may have multiple nodes coalescing to same key — keep first)
seen=set(); nrows=[]
for n in nodes:
    if n["key"] in seen: continue
    seen.add(n["key"]); nrows.append((n["key"], n["labels"], json.dumps(dict(n["props"]), default=str)))
execute_values(cur, "INSERT INTO graph_node (key,labels,props) VALUES %s", nrows, page_size=1000)
erows=[(e["src"], e["dst"], e["rel"]) for e in edges]
execute_values(cur, "INSERT INTO graph_edge (src_key,dst_key,rel_type) VALUES %s", erows, page_size=1000)
cur.execute("CREATE INDEX ON graph_edge (dst_key, rel_type)")
cur.execute("CREATE INDEX ON graph_edge (src_key, rel_type)")
print(f"loaded {len(nrows)} nodes, {len(erows)} edges into Postgres")

def pg_impact(k, maxd=10):
    cur.execute("""WITH RECURSIVE impact(key,depth) AS (
        SELECT src_key,1 FROM graph_edge WHERE dst_key=%s AND rel_type = ANY(%s)
        UNION SELECT e.src_key, i.depth+1 FROM graph_edge e JOIN impact i ON e.dst_key=i.key
          WHERE e.rel_type = ANY(%s) AND i.depth < %s)
        SELECT DISTINCT key FROM impact""", (k, IMPACT, IMPACT, maxd))
    return {r[0] for r in cur.fetchall()}

def neo_impact(k, maxd=10, sess=None):
    rel = "|".join(IMPACT)
    rows = sess.run(f"MATCH (o) WHERE coalesce(o.productId,o.ciId,o.nodeId,o.slug)=$k "
                    f"MATCH (o)<-[:{rel}*1..{maxd}]-(a) "
                    "RETURN DISTINCT coalesce(a.productId,a.ciId,a.nodeId,a.slug) AS key", k=k)
    return {r["key"] for r in rows if r["key"] is not None}

def pg_neigh(k):
    cur.execute("SELECT src_key,rel_type FROM graph_edge WHERE dst_key=%s", (k,)); inc={(r[0],r[1]) for r in cur.fetchall()}
    cur.execute("SELECT dst_key,rel_type FROM graph_edge WHERE src_key=%s", (k,)); out={(r[0],r[1]) for r in cur.fetchall()}
    return inc, out

def neo_neigh(k, sess):
    inc={(r["n"],r["t"]) for r in sess.run("MATCH (t)-[r]->(me) WHERE coalesce(me.productId,me.ciId,me.nodeId,me.slug)=$k RETURN coalesce(t.productId,t.ciId,t.nodeId,t.slug) AS n, type(r) AS t", k=k)}
    out={(r["n"],r["t"]) for r in sess.run("MATCH (me)-[r]->(t) WHERE coalesce(me.productId,me.ciId,me.nodeId,me.slug)=$k RETURN coalesce(t.productId,t.ciId,t.nodeId,t.slug) AS n, type(r) AS t", k=k)}
    return inc, out

# sample nodes that actually have incoming impact edges (impactful origins)
cur.execute("SELECT DISTINCT dst_key FROM graph_edge WHERE rel_type = ANY(%s) LIMIT 40", (IMPACT,))
sample = [r[0] for r in cur.fetchall()]
imp_match = imp_total = 0
nei_match = nei_total = 0
with drv.session() as s:
    for k in sample:
        pg, ne = pg_impact(k), neo_impact(k, sess=s)
        imp_match += (pg == ne); imp_total += 1
    cur.execute("SELECT key FROM graph_node LIMIT 40"); nsample=[r[0] for r in cur.fetchall()]
    for k in nsample:
        pgn, nen = pg_neigh(k), neo_neigh(k, s)
        nei_match += (pgn == nen); nei_total += 1
drv.close()

print("\n===================== GRAPH A/B PARITY =====================")
print(f"graph: {len(nrows)} nodes / {len(erows)} edges (real Neo4j)")
print(f"downstream-impact parity: {imp_match}/{imp_total} sample origins IDENTICAL affected-set")
print(f"neighbours parity:        {nei_match}/{nei_total} sample nodes IDENTICAL in/out sets")
print("===========================================================")
print(json.dumps({"nodes":len(nrows),"edges":len(erows),
                  "impact_match":imp_match,"impact_total":imp_total,
                  "neigh_match":nei_match,"neigh_total":nei_total}))
