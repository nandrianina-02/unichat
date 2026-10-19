import type { D1Migration } from "cloudflare:test";
import type { Boite } from "../src/temps-reel/boite";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BOITE: DurableObjectNamespace<Boite>;
      TEST_MIGRATIONS: D1Migration[];
      KARAKS_STORAGE_URL?: string;
      VAPID_PRIVEE?: string;
      ADMINS?: string;
    }
  }
}
