# BET-5 datastore-hybridization benchmark harness

A/B: Postgres (pgvector+HNSW, recursive CTE) vs Qdrant + Neo4j. See the results + verdict
in `docs/superpowers/specs/2026-07-12-bet5-datastore-benchmark-results.md`.

Run (from repo root, with the dpf stack up):
```
docker run -d --name bet5-pgvector --network dpf_default -e POSTGRES_PASSWORD=bench \
  -e POSTGRES_USER=bench -e POSTGRES_DB=bench pgvector/pgvector:pg16
docker exec bet5-pgvector psql -U bench -d bench -c 'CREATE EXTENSION vector'
# vectors:
docker run --rm --network dpf_default -e N=50000 -e EFS=40,100,200 \
  -v "$PWD/benchmarks/bet5-datastore/vec_bench.py:/b.py:ro" python:3.12-slim \
  bash -c 'pip install -q numpy psycopg2-binary && python /b.py'
# graph (NEO_PW from the neo4j container's NEO4J_AUTH):
docker run --rm --network dpf_default -e NODES=24803 -e EDGES=31708 -e NEO_PW=<pw> \
  -v "$PWD/benchmarks/bet5-datastore/graph_bench.py:/g.py:ro" python:3.12-slim \
  bash -c 'pip install -q numpy psycopg2-binary neo4j && python /g.py'
docker rm -f bet5-pgvector
```
