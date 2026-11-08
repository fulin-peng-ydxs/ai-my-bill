import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const prototypeDir = path.dirname(fileURLToPath(import.meta.url));
export const css = fs.readFileSync(path.join(prototypeDir, "prototype.css"), "utf8");
export const htmlFiles = fs.readdirSync(prototypeDir).filter((file) => file.endsWith(".html"));
export const readPrototype = (file) => fs.readFileSync(path.join(prototypeDir, file), "utf8");
