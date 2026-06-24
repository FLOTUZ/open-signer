import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SatSignatureService } from "../src/services/SatSignatureService";

const certsDir = path.resolve(__dirname, "sat_certs/Cert_Prod");

const files = fs.readdirSync(certsDir);
const cerFiles = files.filter((file) =>
  file.toLowerCase().endsWith(".cer") || file.toLowerCase().endsWith(".crt")
);

const rootBuffers = cerFiles.map((file) =>
  fs.readFileSync(path.join(certsDir, file))
);

SatSignatureService.initTrustedRoots(rootBuffers);

console.log(`Cargados ${rootBuffers.length} certificados raíz/intermedios.`);
