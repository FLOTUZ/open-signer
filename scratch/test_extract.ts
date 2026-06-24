import { S3StorageService } from "../src/services/S3StorageService";

async function main() {
  const urlWithSpecialChars =
    "https://opensigner.s3.us-east-2.amazonaws.com/1782423562129_CertificaciÃ³n_de_Sistema_de_Salud_NOM-024.pdf";

  const key = decodeURIComponent(
    S3StorageService.extractKey(urlWithSpecialChars),
  );
  console.log("Original URL:", urlWithSpecialChars);
  console.log("Extracted Key Decoded:", key);

  try {
    const client = (S3StorageService as any).getS3Client();
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({
      Bucket: "opensigner",
      Key: key,
    });
    const presignedUrl = await getSignedUrl(client, command, {
      expiresIn: 300,
    });
    console.log("Presigned URL:", presignedUrl);
  } catch (err) {
    console.error("Error generating presigned:", err);
  }
}

main().catch((err) => console.error(err));
