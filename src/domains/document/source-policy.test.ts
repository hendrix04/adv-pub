import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { authorizedDiscoverySources, isAuthorizedDiscoverySource } from "./source-policy.js";

test("the incremental launcher admits only the nine supplied corpus documents", () => {
  const names = [
    "01-unified-church-of-the-realms.md",
    "02-county-of-swordmount.md",
    "03-laeral-silverhand-decline-of-magic.md",
    "04-ridurs-tale.md",
    "05-beic-god-of-merchants.md",
    "06-factions-and-organizations.md",
    "07-the-netherese-civil-war.md",
    "08-pantheon_refresh.md",
    "09-a-gazetteer-of-the-realms.md",
  ];
  assert.deepEqual(
    authorizedDiscoverySources(),
    names.map((name) => resolve("Resources/Lore", name)),
  );
  for (const name of names) {
    assert.equal(isAuthorizedDiscoverySource(`Resources/Lore/${name}`), true, name);
  }
  assert.equal(isAuthorizedDiscoverySource("Resources/Lore/not-a-corpus-source.md"), false);
  assert.equal(isAuthorizedDiscoverySource("other/01-unified-church-of-the-realms.md"), false);
});
