import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { CSP } from "./worker/csp.ts";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Writes dist/sw.js with the exact list of files the build produced, and
 * dist/_headers with the same CSP the Worker sends. The root page is served
 * straight from static assets, never through the Worker, and the service
 * worker caches that copy — so without this file the app shell phones run
 * offline would carry no CSP at all.
 */
function offlineShell(): Plugin {
  let outDir = "dist";
  return {
    name: "nho-nha-offline-shell",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      writeFileSync(
        join(outDir, "_headers"),
        [
          "/*",
          "  Referrer-Policy: no-referrer",
          "  X-Content-Type-Options: nosniff",
          "/",
          `  Content-Security-Policy: ${CSP}`,
          "  Cache-Control: no-cache",
          "/sw.js",
          "  Cache-Control: no-cache",
          "/assets/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "/fonts/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      );

      const files = filesUnder(outDir)
        .map((f) => `/${relative(outDir, f).split(sep).join("/")}`)
        .filter((f) => f !== "/index.html" && f !== "/sw.js" && !/\/[._]/.test(f) && !f.endsWith(".txt"));
      const hash = createHash("sha256");
      for (const f of filesUnder(outDir).sort()) if (!f.endsWith(`${sep}sw.js`)) hash.update(readFileSync(f));
      const source = readFileSync("src/sw.js", "utf8")
        .replace("__VERSION__", hash.digest("hex").slice(0, 12))
        .replace("__PRECACHE__", JSON.stringify(["/", ...files.sort()]));
      // A placeholder left in would make the worker throw on install, and
      // the app would quietly lose offline mode with nothing on screen.
      if (/__[A-Z]+__/.test(source)) throw new Error("sw.js still has an unfilled placeholder");
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  define: {
    // Vietnam time, since that is the clock Hải will compare it with.
    __BUILD__: JSON.stringify(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 16)),
  },
  build: {
    target: "es2022",
  },
});
