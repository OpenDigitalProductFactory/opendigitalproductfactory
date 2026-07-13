#!/usr/bin/env python3
"""BET-5 graph benchmark: Postgres recursive-CTE vs Neo4j on code-graph traversal.
Synthetic DAG sized to the LIVE code-graph (24.8k nodes / 31.7k edges). Workloads:
(1) bounded 3-hop neighborhood, (2) full transitive impact (reverse reachability)."""
import os, time, statistics
import numpy as np
import psycopg2
from neo4j import GraphDatabase

NODES = int(os.environ.get("NODES", "24803"))
EDGES = int(os.environ.get("EDGES", "31708"))
SEEDS = int(os.environ.get("SEEDS", "200"))
GK = "bet5bench"
PG = dict(host="bet5-pgvector", dbname="bench", user="bench", password="bench")
NEO_PW = os.environ["NEO_PW"]
def pct(xs,p): return sorted(xs)[min(len(xs)-1,int(len(xs)*p))]

rng = np.random.default_rng(7)
# DAG: each node points to a few higher-indexed nodes (layered dependency graph, fan-in on
# shared modules). Reverse reachability from a node = its transitive dependents (impact set).
src=[]; dst=[]
per = EDGES/NODES
for i in range(NODES):
    k = rng.poisson(per)
    for _ in range(k):
        j = min(NODES-1, i + 1 + int(rng.exponential(30)))
        if j>i: src.append(i); dst.append(j)
E = list(zip(src,dst)); random_seeds = rng.integers(0,NODES,size=SEEDS).tolist()
print(f"== BET-5 graph A/B :: nodes={NODES} edges={len(E)} seeds={SEEDS} (DAG ~ live code-graph) ==",flush=True)

# ---- Postgres ----
pg=psycopg2.connect(**PG); pg.autocommit=True; c=pg.cursor()
c.execute("DROP TABLE IF EXISTS edges")
c.execute("CREATE TABLE edges(src int, dst int)")
from psycopg2.extras import execute_values
t=time.time(); execute_values(c,"INSERT INTO edges(src,dst) VALUES %s",E,page_size=5000)
c.execute("CREATE INDEX ON edges(dst)"); c.execute("CREATE INDEX ON edges(src)"); c.execute("ANALYZE edges")
pg_load=time.time()-t
# bounded 3-hop dependents
pg_hop=[]
for s in random_seeds:
    t=time.time()
    c.execute("""WITH RECURSIVE r(id,d) AS (SELECT %s,0 UNION SELECT e.src,r.d+1 FROM edges e JOIN r ON e.dst=r.id WHERE r.d<3)
                 SELECT count(DISTINCT id) FROM r""",(s,)); c.fetchone()
    pg_hop.append((time.time()-t)*1000)
# full transitive impact
pg_imp=[]
for s in random_seeds:
    t=time.time()
    c.execute("""WITH RECURSIVE r(id) AS (SELECT src FROM edges WHERE dst=%s UNION SELECT e.src FROM edges e JOIN r ON e.dst=r.id)
                 SELECT count(*) FROM r""",(s,)); c.fetchone()
    pg_imp.append((time.time()-t)*1000)

# ---- Neo4j ----
drv=GraphDatabase.driver("bolt://dpf-neo4j-1:7687",auth=("neo4j",NEO_PW))
with drv.session() as s:
    s.run("MATCH (n:BenchNode {gk:$gk}) DETACH DELETE n",gk=GK)
    t=time.time()
    s.run("UNWIND range(0,$n-1) AS i CREATE (:BenchNode {gk:$gk, gid:i})",n=NODES,gk=GK)
    s.run("CREATE INDEX bench_gid IF NOT EXISTS FOR (n:BenchNode) ON (n.gk,n.gid)")
    for b in range(0,len(E),5000):
        chunk=[{"a":a,"b":bb} for a,bb in E[b:b+5000]]
        s.run("""UNWIND $es AS e MATCH (x:BenchNode {gk:$gk,gid:e.a}),(y:BenchNode {gk:$gk,gid:e.b}) CREATE (x)-[:DEP]->(y)""",es=chunk,gk=GK)
    neo_load=time.time()-t
    neo_hop=[]
    for sd in random_seeds:
        t=time.time()
        s.run("MATCH (x:BenchNode {gk:$gk,gid:$s})<-[:DEP*1..3]-(a) RETURN count(DISTINCT a)",gk=GK,s=sd).single()
        neo_hop.append((time.time()-t)*1000)
    neo_imp=[]
    for sd in random_seeds:
        t=time.time()
        s.run("MATCH (x:BenchNode {gk:$gk,gid:$s})<-[:DEP*1..]-(a) RETURN count(DISTINCT a)",gk=GK,s=sd).single()
        neo_imp.append((time.time()-t)*1000)
    s.run("MATCH (n:BenchNode {gk:$gk}) DETACH DELETE n",gk=GK)
drv.close()

print("\n===================== RESULTS =====================",flush=True)
print(f"load {NODES}n/{len(E)}e:  postgres {pg_load:.1f}s   neo4j {neo_load:.1f}s")
print(f"\n{'workload':<26}{'pg p50ms':>10}{'pg p95ms':>10}{'  ':>4}{'neo p50ms':>10}{'neo p95ms':>10}")
print(f"{'3-hop dependents':<26}{pct(pg_hop,.5):>10.2f}{pct(pg_hop,.95):>10.2f}{'  ':>4}{pct(neo_hop,.5):>10.2f}{pct(neo_hop,.95):>10.2f}")
print(f"{'full transitive impact':<26}{pct(pg_imp,.5):>10.2f}{pct(pg_imp,.95):>10.2f}{'  ':>4}{pct(neo_imp,.5):>10.2f}{pct(neo_imp,.95):>10.2f}")
print("===================================================",flush=True)
