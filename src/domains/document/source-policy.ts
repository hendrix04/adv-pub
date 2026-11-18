import { resolve } from "node:path";

const authorizedSources = new Set(
  [
    "01-unified-church-of-the-realms.md",
    "02-county-of-swordmount.md",
    "03-laeral-silverhand-decline-of-magic.md",
    "04-ridurs-tale.md",
    "05-beic-god-of-merchants.md",
    "06-factions-and-organizations.md",
    "07-the-netherese-civil-war.md",
    "08-pantheon_refresh.md",
    "09-a-gazetteer-of-the-realms.md",
  ].map((name) => resolve("Resources/Lore", name)),
);

export function isAuthorizedDiscoverySource(sourcePath: string): boolean {
  return authorizedSources.has(resolve(sourcePath));
}

export function authorizedDiscoverySources(): string[] {
  return [...authorizedSources];
}
