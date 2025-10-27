const core = require("./blockchain");

async function mintDigitalId(name, passportId, options = {}) {
  try {
    const result = await core.mintDigitalId(name, passportId, options);
    if (result && result.txHash) {
      console.log("[blockchain] Digital ID minted", result.txHash);
    }
    return result;
  } catch (error) {
    console.error("[blockchain] mintDigitalId failed", error?.message || error);
    return null;
  }
}

async function mintGroupId(groupId, metadataURI = "") {
  try {
    const result = await core.mintGroupId(groupId, metadataURI);
    if (result && result.txHash) {
      console.log("[blockchain] Group ID minted", result.txHash);
    }
    return result;
  } catch (error) {
    console.error("[blockchain] mintGroupId failed", error?.message || error);
    return null;
  }
}

module.exports = {
  ...core,
  mintDigitalId,
  mintGroupId
};



