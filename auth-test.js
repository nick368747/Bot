const path = require("path");

const {
  Authflow,
  Titles
} = require("prismarine-auth");

const cacheDir = path.join(
  process.cwd(),
  ".auth-test"
);

const username = "FrozenRun";

console.log("");
console.log("=================================");
console.log(" MICROSOFT AUTH TEST");
console.log("=================================");
console.log("");
console.log("Starte Microsoft-Anmeldung...");
console.log("");

const authflow = new Authflow(
  username,
  cacheDir,
  {
    flow: "live",
    authTitle: Titles.MinecraftNintendoSwitch,
    deviceType: "Nintendo",
    forceRefresh: true
  },
  data => {
    console.log("");
    console.log("=================================");
    console.log(" MICROSOFT LOGIN");
    console.log("=================================");
    console.log("");
    console.log("Link:", data.verification_uri);
    console.log("Code:", data.user_code);
    console.log(
      "Gültig für:",
      data.expires_in,
      "Sekunden"
    );
    console.log("");
    console.log("=================================");
    console.log("");
  }
);

async function testen() {
  try {
    console.log("Fordere Microsoft-Token an...");

    const msaToken =
      await authflow.getMsaToken();

    if (!msaToken) {
      throw new Error(
        "Microsoft-Token wurde nicht erhalten."
      );
    }

    console.log("");
    console.log("OK: Microsoft-Token erhalten.");
    console.log("");

    console.log("Fordere Xbox-Token an...");

    const xboxToken =
      await authflow.getXboxToken();

    if (!xboxToken) {
      throw new Error(
        "Xbox-Token wurde nicht erhalten."
      );
    }

    console.log("");
    console.log("OK: Xbox-Token erhalten.");
    console.log("");

    console.log(
      "Fordere Minecraft-Bedrock-Token an..."
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
    console.log(" AUTHENTIFIZIERUNG ERFOLGREICH");
    console.log("=================================");
    console.log("");
    console.log("Microsoft: OK");
    console.log("Xbox: OK");
    console.log("Minecraft Bedrock: OK");
    console.log("");
    console.log(
      "Der Microsoft-Login funktioniert."
    );
    console.log("");

    process.exit(0);
  } catch (error) {
    console.log("");
    console.log("=================================");
    console.log(" AUTHENTIFIZIERUNG FEHLGESCHLAGEN");
    console.log("=================================");
    console.log("");

    console.log(
      "Fehlertyp:",
      error?.name || "Unbekannt"
    );

    console.log("");
    console.log("Fehlermeldung:");

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
