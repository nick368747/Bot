const fs = require("fs");
const path = require("path");

const {
  Authflow,
  Titles
} = require("prismarine-auth");

const cacheDir = path.join(
  process.cwd(),
  ".auth-test-sisu"
);

const username = "FrozenRun";

console.log("");
console.log("=================================");
console.log(" MICROSOFT SISU AUTH TEST");
console.log("=================================");
console.log("");
console.log("Flow: sisu");
console.log("AuthTitle: MinecraftAndroid");
console.log("DeviceType: Android");
console.log("");

try {
  fs.rmSync(
    cacheDir,
    {
      recursive: true,
      force: true
    }
  );

  fs.mkdirSync(
    cacheDir,
    {
      recursive: true
    }
  );
} catch (error) {
  console.log(
    "Fehler beim Erstellen des Test-Caches:"
  );

  console.log(
    error?.message || error
  );

  process.exit(1);
}

const authflow = new Authflow(
  username,
  cacheDir,
  {
    flow: "sisu",
    authTitle:
      Titles.MinecraftAndroid,
    deviceType: "Android",
    forceRefresh: true
  },
  data => {
    console.log("");
    console.log("=================================");
    console.log(" MICROSOFT LOGIN");
    console.log("=================================");
    console.log("");
    console.log(
      "Link:",
      data.verification_uri
    );
    console.log(
      "Code:",
      data.user_code
    );
    console.log(
      "Gültig für:",
      data.expires_in,
      "Sekunden"
    );
    console.log("");
    console.log(
      "Code jetzt bei Microsoft eingeben."
    );
    console.log("");
    console.log("=================================");
    console.log("");
  }
);

async function testen() {
  try {
    console.log(
      "1/3 Microsoft-Authentifizierung..."
    );

    const msaToken =
      await authflow.getMsaToken();

    if (!msaToken) {
      throw new Error(
        "Microsoft-Token wurde nicht erhalten."
      );
    }

    console.log(
      "OK: Microsoft-Token erhalten."
    );

    console.log("");
    console.log(
      "2/3 Xbox-Authentifizierung..."
    );

    const xboxToken =
      await authflow.getXboxToken();

    if (!xboxToken) {
      throw new Error(
        "Xbox-Token wurde nicht erhalten."
      );
    }

    console.log(
      "OK: Xbox-Token erhalten."
    );

    console.log("");
    console.log(
      "3/3 Minecraft-Bedrock-Authentifizierung..."
    );

    const bedrockToken =
      await authflow.getMinecraftBedrockToken();

    if (!bedrockToken) {
      throw new Error(
        "Minecraft-Bedrock-Token wurde nicht erhalten."
      );
    }

    console.log("");
    console.log("=================================");
    console.log(" SISU TEST ERFOLGREICH");
    console.log("=================================");
    console.log("");
    console.log("Microsoft: OK");
    console.log("Xbox: OK");
    console.log("Minecraft Bedrock: OK");
    console.log("");
    console.log(
      "Der sisu-Authentifizierungsweg funktioniert."
    );
    console.log("");

    process.exit(0);
  } catch (error) {
    console.log("");
    console.log("=================================");
    console.log(" SISU TEST FEHLGESCHLAGEN");
    console.log("=================================");
    console.log("");

    console.log(
      "Fehlertyp:",
      error?.name || "Unbekannt"
    );

    console.log("");

    console.log(
      "Fehlermeldung:"
    );

    console.log(
      error?.message || error
    );

    console.log("");

    if (error?.stack) {
      console.log("Stack:");
      console.log(error.stack);
    }

    console.log("");

    process.exit(1);
  }
}

testen();
