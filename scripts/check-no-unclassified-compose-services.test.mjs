import assert from "node:assert/strict";
import test from "node:test";

import { checkComposeRecreateClasses, RECREATE_CLASSES } from "./check-no-unclassified-compose-services.mjs";

// BI-22A2CA0D: #6020 gave portal-tls a reaping init, but no self-upgrade step
// knew it could recreate portal-tls. Every compose service now declares how the
// promoter may converge it, on the service itself.

const base = `services:
  postgres:
    image: postgres
    labels:
      dpf.recreate-class: data-owner
  portal:
    image: dpf-portal
    labels:
      dpf.recreate-class: managed
`;
const overlay = `services:
  portal:
    environment:
      A: "1"
`;

test("classes are the closed set the promoter understands", () => {
  assert.deepEqual([...RECREATE_CLASSES].sort(), ["data-owner", "managed", "stateless"]);
});

test("an overlay re-declaring a labelled service passes", () => {
  assert.deepEqual(checkComposeRecreateClasses({ "docker-compose.yml": base, "docker-compose.macos.yml": overlay }), []);
});

test("a service with no class in any file fails, naming the file", () => {
  const tls = "services:\n  portal-tls:\n    image: caddy\n    init: true\n";
  assert.deepEqual(checkComposeRecreateClasses({ "docker-compose.yml": base, "docker-compose.tls.yml": tls }), [
    "unclassified_compose_service:portal-tls (docker-compose.tls.yml): add labels: dpf.recreate-class: stateless|data-owner|managed",
  ]);
});

test("an unknown class fails", () => {
  const bad = "services:\n  cache:\n    image: redis\n    labels:\n      dpf.recreate-class: sometimes\n";
  assert.deepEqual(checkComposeRecreateClasses({ "docker-compose.x.yml": bad }), [
    "invalid_recreate_class:cache (docker-compose.x.yml): sometimes",
  ]);
});

test("two files disagreeing about a service fail", () => {
  const other = "services:\n  postgres:\n    labels:\n      dpf.recreate-class: stateless\n";
  assert.deepEqual(checkComposeRecreateClasses({ "docker-compose.yml": base, "docker-compose.dev.yml": other }), [
    "conflicting_recreate_class:postgres: data-owner (docker-compose.yml) vs stateless (docker-compose.dev.yml)",
  ]);
});

test("other labels on a service are kept apart from the class", () => {
  const withOther = "services:\n  web:\n    image: x\n    labels:\n      com.example.team: core\n      dpf.recreate-class: stateless\n";
  assert.deepEqual(checkComposeRecreateClasses({ "docker-compose.yml": withOther }), []);
});
