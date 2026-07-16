import fs from "node:fs";
import path from "node:path";

import {
  buildNavigationProjection,
  FRONTEND_OWNED_NAVIGATION_ITEMS,
  type NavigationProjectionSource,
} from "../src/components/navigation/navigationProjection";


function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type RoleNavigationFixture = {
  frontend_owned_hrefs: string[];
  backend_hrefs_by_role: Record<string, string[]>;
  sidebar_hrefs_by_role: Record<string, string[]>;
};

const fixturePath = path.resolve(
  process.cwd(),
  "..",
  "contracts",
  "fixtures",
  "navigation",
  "role-navigation.current.json"
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RoleNavigationFixture;

assert(
  JSON.stringify(FRONTEND_OWNED_NAVIGATION_ITEMS.map((item) => item.href))
    === JSON.stringify(fixture.frontend_owned_hrefs),
  "Frontend-owned navigation routes changed without updating the role contract."
);

for (const [role, backendHrefs] of Object.entries(fixture.backend_hrefs_by_role)) {
  const backendNavigation: NavigationProjectionSource[] = backendHrefs.map((href) => ({
    href,
    label: `backend:${href}`,
  }));
  const groups = buildNavigationProjection(backendNavigation, "/");
  const actualHrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  const expectedHrefs = fixture.sidebar_hrefs_by_role[role];

  assert(expectedHrefs !== undefined, `${role}: expected sidebar projection is missing.`);
  assert(
    JSON.stringify(actualHrefs) === JSON.stringify(expectedHrefs),
    `${role}: sidebar projection changed.\nExpected: ${expectedHrefs.join(", ")}\nActual: ${actualHrefs.join(", ")}`
  );
}

const salesHrefs = fixture.sidebar_hrefs_by_role.sales;
assert(salesHrefs.includes("/prijsvoorstellen"), "Sales must retain quote navigation.");
assert(!salesHrefs.includes("/nieuwe-kostprijsberekening"), "Sales must not see cost-draft navigation.");
assert(!salesHrefs.includes("/recept-hercalculatie"), "Sales must not see brewing recalculation navigation.");
assert(!salesHrefs.includes("/inkoopfacturen"), "Sales must not see purchase invoice navigation.");
assert(!salesHrefs.includes("/beheer/productkoppeling"), "Sales must not see product mapping navigation.");

const brewerHrefs = fixture.sidebar_hrefs_by_role.brewer;
assert(!brewerHrefs.includes("/prijsvoorstellen"), "Brewer must not see quote navigation.");
assert(brewerHrefs.includes("/nieuwe-kostprijsberekening"), "Brewer must retain cost-draft navigation.");

const managementHrefs = fixture.sidebar_hrefs_by_role.management;
assert(!managementHrefs.includes("/beheer/productkoppeling"), "Management must not see product mapping navigation.");

console.log("navigation permissions contracttest OK");
