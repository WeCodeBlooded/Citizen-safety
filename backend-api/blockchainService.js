const { ethers } = require("ethers");


const HARDHAT_RPC_URL = "http://127.0.0.1:8545"; 
const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";


const provider = new ethers.JsonRpcProvider(HARDHAT_RPC_URL);


const signer = new ethers.Wallet(PRIVATE_KEY, provider);




const contractABI = [
  {
    inputs: [
      { internalType: "string", name: "_name", type: "string" },
      { internalType: "string", name: "_passportId", type: "string" },
    ],
    name: "createId",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  
  {
    inputs: [{ internalType: "string", name: "_groupId", type: "string" }],
    name: "createGroup",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];


const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, signer);


const mintDigitalId = async (name, passportId) => {
  try {
    console.log("Minting Digital ID on the blockchain...");
    const tx = await contract.createId(name, passportId);
    await tx.wait(); 
    console.log("Digital ID minted successfully! Transaction:", tx.hash);
    return tx.hash;
  } catch (error) {
    console.error("Error minting Digital ID:", error);
  }
};

const mintGroupId = async (groupId) => {
    try {
        console.log(`Minting Group ID ${groupId} on the blockchain...`);
        const tx = await contract.createGroup(groupId);
        await tx.wait(); 
        console.log("Group ID minted successfully! Transaction:", tx.hash);
        return tx.hash;
    } catch (error) {
        console.error("Error minting Group ID:", error);
    }
};

module.exports = { mintDigitalId, mintGroupId };
