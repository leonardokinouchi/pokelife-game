const fs = require("node:fs");
fs.cpSync("public", "dist", { recursive: true });
fs.copyFileSync(require.resolve("phaser/dist/phaser.min.js"), "dist/phaser.js");
