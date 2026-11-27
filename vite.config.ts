import { gzipSync } from "node:zlib";
import { defineConfig } from "vite";

// Twelve players can request the same level at once. Compress its static models
// during the build so the game server only has to read the chosen representation.
export default defineConfig({
  plugins: [{
    name: "compress-hide-map-models",
    generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".bin")) continue;
        this.emitFile({
          type: "asset",
          fileName: asset.fileName + ".gz",
          source: gzipSync(asset.source, { level: 9 }),
        });
      }
    },
  }],
});
