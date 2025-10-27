const { ethers } = require("ethers");
const {
  DEFAULT_RPC_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_PRIVATE_KEY,
  getContractAddress,
  loadDigitalIDArtifact
} = require("./config");

let cachedProvider = null;
let cachedReadContract = null;
let cachedWriteContract = null;
let cachedSigner = null;

function getProvider() {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL, DEFAULT_CHAIN_ID);
  }
  return cachedProvider;
}

function getSigner() {
  if (cachedSigner) {
    return cachedSigner;
  }
  const privateKey = DEFAULT_PRIVATE_KEY;
  if (!privateKey) {
    return null;
  }
  cachedSigner = new ethers.Wallet(privateKey, getProvider());
  return cachedSigner;
}

function buildContractConnection(connection) {
  const artifact = loadDigitalIDArtifact();
  const address = getContractAddress();
  if (!address) {
    throw new Error("DigitalID contract address is not configured.");
  }
  return new ethers.Contract(address, artifact.abi, connection);
}

function getReadOnlyContract() {
  if (!cachedReadContract) {
    cachedReadContract = buildContractConnection(getProvider());
  }
  return cachedReadContract;
}

function getWritableContract() {
  const signer = getSigner();
  if (!signer) {
    throw new Error("Blockchain signing key is not configured.");
  }
  if (!cachedWriteContract) {
    cachedWriteContract = buildContractConnection(signer);
  }
  return cachedWriteContract;
}

function resetConnections() {
  cachedProvider = null;
  cachedReadContract = null;
  cachedWriteContract = null;
  cachedSigner = null;
}

module.exports = {
  getProvider,
  getSigner,
  getReadOnlyContract,
  getWritableContract,
  resetConnections
};
