import crypto from 'crypto';
import forge from 'node-forge';
import fs from 'fs';
import path from 'path';

function getUrls() {
    try {
        const certsDir = process.env.SAT_CERTS_DIR || "/app/certs/sat";
        // we'll try to find any cert if running inside container or locally.
        const files = fs.readdirSync(certsDir);
        const cerFiles = files.filter((file) => file.toLowerCase().endsWith(".cer") || file.toLowerCase().endsWith(".crt"));
        
        if (cerFiles.length === 0) return console.log("No certs found");

        const cerBuffer = fs.readFileSync(path.join(certsDir, cerFiles[0]));
        const cert = new crypto.X509Certificate(cerBuffer);
        
        console.log("crypto infoAccess:\n", cert.infoAccess);
        
        const der = forge.util.createBuffer(cerBuffer.toString('binary'));
        const asn1 = forge.asn1.fromDer(der);
        const forgeCert = forge.pki.certificateFromAsn1(asn1);

        console.log("Forge Extensions:");
        for (const ext of forgeCert.extensions || []) {
            console.log(ext.name, ext.value);
            if (ext.name === 'cRLDistributionPoints') {
                console.log("CRL Details:", ext);
            }
            if (ext.name === 'authorityInfoAccess') {
                console.log("AIA Details:", ext);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

getUrls();
