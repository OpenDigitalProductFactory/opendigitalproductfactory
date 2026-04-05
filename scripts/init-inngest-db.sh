#!/bin/sh
# Create the 'inngest' database if it doesn't exist.
# Mounted to /docker-entrypoint-initdb.d/ on the postgres container.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE inngest'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inngest')\gexec
EOSQL
