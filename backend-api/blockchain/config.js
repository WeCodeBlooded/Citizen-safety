const fs = require("fs");
const path = require("path");

const DEFAULT_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || process.env.DIGITAL_ID_RPC_URL || "http://127.0.0.1:8545";
const DEFAULT_CHAIN_ID = Number(process.env.BLOCKCHAIN_CHAIN_ID || process.env.DIGITAL_ID_CHAIN_ID || 31337);
const DEFAULT_PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY || process.env.DIGITAL_ID_OPERATOR_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEFAULT_CONTRACT_ADDRESS = process.env.DIGITAL_ID_CONTRACT_ADDRESS || process.env.BLOCKCHAIN_CONTRACT_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

function resolveArtifactCandidates() {
  return [
    path.resolve(__dirname, "..", "..", "hardhat-node", "artifacts", "contracts", "DigitalID.sol", "DigitalID.json"),
    path.resolve(__dirname, "..", "..", "hardhat", "artifacts", "contracts", "DigitalID.sol", "DigitalID.json"),
    path.resolve(__dirname, "..", "..", "artifacts", "DigitalID.json")
  ];
}

function loadDigitalIDArtifact() {
  const candidates = resolveArtifactCandidates();
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.abi) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn("[blockchain] failed to read artifact", candidate, error?.message);
    }
  }
  throw new Error("DigitalID artifact not found. Run `npx hardhat compile` inside hardhat-node.");
}

function getContractAddress() {
  return DEFAULT_CONTRACT_ADDRESS;
}

module.exports = {
  DEFAULT_RPC_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_PRIVATE_KEY,
  DEFAULT_CONTRACT_ADDRESS,
  loadDigitalIDArtifact,
  getContractAddress
};
