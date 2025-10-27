const { ethers } = require("ethers");
const {
  getWritableContract,
  getReadOnlyContract,
  getProvider,
  getSigner,
  resetConnections
} = require("./client");
const {
  computePassportHash,
  resolvePassportHash,
  normalizeIdentifier
} = require("./utils");

function extractEvent(receipt, contract, eventName) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

function mapTouristStruct(passportHash, raw) {
  if (!raw || raw.registrationDate === undefined) {
    return null;
  }
  const registeredAt = Number(raw.registrationDate);
  if (!registeredAt) {
    return null;
  }
  return {
    name: raw.name,
    passportHash,
    account: raw.account,
    issuer: raw.issuer,
    registrationDate: registeredAt,
    active: Boolean(raw.active),
    metadataURI: raw.metadataURI
  };
}

function mapAlertStruct(raw) {
  return {
    id: Number(raw.id),
    passportHash: raw.passportHash,
    raisedBy: raw.raisedBy,
    timestamp: Number(raw.timestamp),
    location: raw.location,
    severity: Number(raw.severity),
    metadataURI: raw.metadataURI
  };
}

function mapEmergencyStruct(raw) {
  return {
    id: Number(raw.id),
    passportHash: raw.passportHash,
    reportedBy: raw.reportedBy,
    timestamp: Number(raw.timestamp),
    evidenceHash: raw.evidenceHash,
    location: raw.location,
    metadataURI: raw.metadataURI
  };
}

async function mintDigitalId(name, passportIdentifier, options = {}) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const account = options.account || ethers.ZeroAddress;
  const metadataURI = options.metadataURI || "";
  const txResponse = await contract.registerTourist(account, name, passportHash, metadataURI);
  const receipt = await txResponse.wait();
  const event = extractEvent(receipt, contract, "TouristRegistered");
  return {
    txHash: receipt.hash,
    passportHash,
    account: event ? event.args[0] : account,
    blockNumber: receipt.blockNumber
  };
}

async function mintGroupId(groupId, metadataURI = "") {
  const contract = getWritableContract();
  const txResponse = metadataURI
    ? await contract.createGroup(groupId, metadataURI)
    : await contract.createGroup(groupId);
  const receipt = await txResponse.wait();
  extractEvent(receipt, contract, "GroupCreated");
  return {
    txHash: receipt.hash,
    groupId,
    blockNumber: receipt.blockNumber
  };
}

async function registerTourist({ name, passportIdentifier, account, metadataURI = "", active = true }) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const targetAccount = account || ethers.ZeroAddress;
  const txResponse = await contract.registerTourist(targetAccount, name, passportHash, metadataURI);
  const receipt = await txResponse.wait();
  return {
    txHash: receipt.hash,
    passportHash,
    blockNumber: receipt.blockNumber,
    active
  };
}

async function updateTourist({ passportIdentifier, name, account, active, metadataURI = "" }) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const targetAccount = account || ethers.ZeroAddress;
  const txResponse = await contract.updateTourist(passportHash, name || "", targetAccount, Boolean(active), metadataURI);
  const receipt = await txResponse.wait();
  extractEvent(receipt, contract, "TouristUpdated");
  return {
    txHash: receipt.hash,
    passportHash,
    blockNumber: receipt.blockNumber
  };
}

async function setTouristStatus(passportIdentifier, active) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const txResponse = await contract.setTouristStatus(passportHash, Boolean(active));
  const receipt = await txResponse.wait();
  extractEvent(receipt, contract, "TouristUpdated");
  return {
    txHash: receipt.hash,
    passportHash,
    blockNumber: receipt.blockNumber
  };
}

async function addGroupMember({ groupId, passportIdentifier, account, role = "member" }) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const targetAccount = account || ethers.ZeroAddress;
  const txResponse = await contract.addGroupMember(groupId, passportHash, targetAccount, role);
  const receipt = await txResponse.wait();
  const event = extractEvent(receipt, contract, "GroupMemberAdded");
  return {
    txHash: receipt.hash,
    groupId,
    passportHash,
    role,
    account: event ? event.args[2] : targetAccount,
    blockNumber: receipt.blockNumber
  };
}

async function removeGroupMember(groupId, passportIdentifier) {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const txResponse = await contract.removeGroupMember(groupId, passportHash);
  const receipt = await txResponse.wait();
  extractEvent(receipt, contract, "GroupMemberRemoved");
  return {
    txHash: receipt.hash,
    groupId,
    passportHash,
    blockNumber: receipt.blockNumber
  };
}

async function logAlert(passportIdentifier, location, severity = 0, metadataURI = "") {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const txResponse = await contract.logAlert(passportHash, location, severity, metadataURI);
  const receipt = await txResponse.wait();
  const event = extractEvent(receipt, contract, "AlertLogged");
  return {
    txHash: receipt.hash,
    alertId: event ? Number(event.args[0]) : null,
    passportHash,
    blockNumber: receipt.blockNumber
  };
}

async function logEmergency(passportIdentifier, evidenceHash, location, metadataURI = "") {
  const contract = getWritableContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const txResponse = await contract.logEmergency(passportHash, evidenceHash, location, metadataURI);
  const receipt = await txResponse.wait();
  const event = extractEvent(receipt, contract, "EmergencyLogged");
  return {
    txHash: receipt.hash,
    logId: event ? Number(event.args[0]) : null,
    passportHash,
    blockNumber: receipt.blockNumber
  };
}

async function recordAudit(action, subjectHash, details = "") {
  const contract = getWritableContract();
  const subject = resolvePassportHash(subjectHash);
  const txResponse = await contract.recordAudit(action, subject, details);
  const receipt = await txResponse.wait();
  const event = extractEvent(receipt, contract, "AuditRecorded");
  return {
    txHash: receipt.hash,
    auditId: event ? Number(event.args[0]) : null,
    blockNumber: receipt.blockNumber
  };
}

async function fetchTourist(passportIdentifier) {
  const contract = getReadOnlyContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const raw = await contract.getTourist(passportHash);
  return mapTouristStruct(passportHash, raw);
}

async function fetchTouristByAccount(account) {
  const contract = getReadOnlyContract();
  const raw = await contract.getTouristByAccount(account);
  const passportHash = raw && raw.passportHash ? raw.passportHash : ethers.ZeroHash;
  return mapTouristStruct(passportHash, raw);
}

async function fetchAlerts(passportIdentifier) {
  const contract = getReadOnlyContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const rawAlerts = await contract.getAlertsForPassport(passportHash);
  return rawAlerts.map(mapAlertStruct);
}

async function fetchEmergencies(passportIdentifier) {
  const contract = getReadOnlyContract();
  const passportHash = resolvePassportHash(passportIdentifier);
  const rawLogs = await contract.getEmergencyLogsForPassport(passportHash);
  return rawLogs.map(mapEmergencyStruct);
}

async function fetchAuditTrail(limit = 25) {
  const contract = getReadOnlyContract();
  const total = Number(await contract.getAuditCount());
  if (!total) {
    return [];
  }
  const count = Math.min(limit, total);
  const queries = [];
  for (let i = 0; i < count; i++) {
    const id = BigInt(total - i);
    queries.push(contract.getAuditEntry(id));
  }
  const rawEntries = await Promise.all(queries);
  return rawEntries.map((entry) => ({
    id: Number(entry.id),
    timestamp: Number(entry.timestamp),
    actor: entry.actor,
    action: entry.action,
    subject: entry.subject,
    details: entry.details
  }));
}

module.exports = {
  getProvider,
  getSigner,
  resetConnections,
  mintDigitalId,
  mintGroupId,
  registerTourist,
  updateTourist,
  setTouristStatus,
  addGroupMember,
  removeGroupMember,
  logAlert,
  logEmergency,
  recordAudit,
  fetchTourist,
  fetchTouristByAccount,
  fetchAlerts,
  fetchEmergencies,
  fetchAuditTrail,
  computePassportHash,
  normalizeIdentifier
};
