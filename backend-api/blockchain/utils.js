const { ethers } = require("ethers");

function normalizeIdentifier(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().toUpperCase();
}

function isBytes32Hash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function computePassportHash(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    throw new Error("Passport identifier required for hashing.");
  }
  return ethers.keccak256(ethers.toUtf8Bytes(normalized));
}

function resolvePassportHash(value) {
  if (isBytes32Hash(value)) {
    return value;
  }
  return computePassportHash(value);
}

module.exports = {
  normalizeIdentifier,
  computePassportHash,
  resolvePassportHash,
  isBytes32Hash
};
