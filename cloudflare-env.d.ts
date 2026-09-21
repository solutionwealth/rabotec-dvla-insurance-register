declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FLEET_ACCESS_PASSWORD_HASH?: string;
    FLEET_SESSION_SECRET?: string;
  }
}
