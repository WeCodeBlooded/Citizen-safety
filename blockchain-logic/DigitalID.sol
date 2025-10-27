// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DigitalID {
    struct Tourist {
        string name;
        bytes32 passportHash;
        address account;
        address issuer;
        uint256 registrationDate;
        bool active;
        string metadataURI;
    }

    struct TourGroup {
        string groupId;
        address creator;
        uint256 creationDate;
        bool active;
        string metadataURI;
    }

    struct GroupMember {
        bytes32 passportHash;
        address account;
        uint256 joinedAt;
        string role;
    }

    struct Alert {
        uint256 id;
        bytes32 passportHash;
        address raisedBy;
        uint256 timestamp;
        string location;
        uint8 severity;
        string metadataURI;
    }

    struct EmergencyLog {
        uint256 id;
        bytes32 passportHash;
        address reportedBy;
        uint256 timestamp;
        string evidenceHash;
        string location;
        string metadataURI;
    }

    struct AuditEntry {
        uint256 id;
        uint256 timestamp;
        address actor;
        string action;
        bytes32 subject;
        string details;
    }

    address public owner;
    mapping(address => bool) public operators;

    mapping(bytes32 => Tourist) private tourists;
    mapping(address => bytes32) private accountToPassport;
    mapping(bytes32 => bool) private passportExists;

    mapping(bytes32 => TourGroup) private tourGroups;
    mapping(bytes32 => GroupMember[]) private groupMembers;
    mapping(bytes32 => mapping(bytes32 => bool)) private groupPassportMembership;
    mapping(bytes32 => mapping(address => bool)) private groupAccountMembership;

    uint256 private nextAlertId = 1;
    mapping(uint256 => Alert) private alerts;
    mapping(bytes32 => uint256[]) private alertIdsByPassport;

    uint256 private nextEmergencyLogId = 1;
    mapping(uint256 => EmergencyLog) private emergencyLogs;
    mapping(bytes32 => uint256[]) private emergencyIdsByPassport;

    uint256 private nextAuditId = 1;
    mapping(uint256 => AuditEntry) private auditEntries;

    event OperatorUpdated(address indexed operator, bool approved);
    event TouristRegistered(address indexed account, bytes32 indexed passportHash, string name, string metadataURI);
    event TouristUpdated(address indexed account, bytes32 indexed passportHash, string name, string metadataURI, bool active);
    event GroupCreated(string indexed groupId, address indexed creator, string metadataURI);
    event GroupUpdated(string indexed groupId, bool active, string metadataURI);
    event GroupMemberAdded(string indexed groupId, bytes32 indexed passportHash, address account, string role);
    event GroupMemberRemoved(string indexed groupId, bytes32 indexed passportHash, address account);
    event AlertLogged(uint256 indexed alertId, bytes32 indexed passportHash, address indexed raisedBy, string location, uint8 severity, string metadataURI);
    event EmergencyLogged(uint256 indexed logId, bytes32 indexed passportHash, address indexed reportedBy, string evidenceHash, string location, string metadataURI);
    event AuditRecorded(uint256 indexed auditId, address indexed actor, string action, bytes32 indexed subject, string details);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOperator() {
        require(operators[msg.sender], "not operator");
        _;
    }

    constructor() {
        owner = msg.sender;
        operators[msg.sender] = true;
        emit OperatorUpdated(msg.sender, true);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        owner = newOwner;
    }

    function setOperator(address operator, bool approved) external onlyOwner {
        operators[operator] = approved;
        emit OperatorUpdated(operator, approved);
    }

    function isTouristActive(bytes32 passportHash) external view returns (bool) {
        return tourists[passportHash].active;
    }

    function hasTourist(bytes32 passportHash) external view returns (bool) {
        return passportExists[passportHash];
    }

    function getTourist(bytes32 passportHash) external view returns (Tourist memory) {
        return tourists[passportHash];
    }

    function getTouristByAccount(address account) external view returns (Tourist memory) {
        bytes32 passportHash = accountToPassport[account];
        return tourists[passportHash];
    }

    function getPassportHashForAccount(address account) external view returns (bytes32) {
        return accountToPassport[account];
    }

    function registerTourist(
        address account,
        string calldata name,
        bytes32 passportHash,
        string calldata metadataURI
    ) external onlyOperator returns (bytes32) {
        return _registerTourist(account, name, passportHash, metadataURI, true);
    }

    function createId(string calldata name, string calldata passportId) external onlyOperator returns (bytes32) {
        bytes32 passportHash = keccak256(abi.encodePacked(passportId));
        return _registerTourist(address(0), name, passportHash, "", true);
    }

    function updateTourist(
        bytes32 passportHash,
        string calldata name,
        address account,
        bool active,
        string calldata metadataURI
    ) external onlyOperator {
        require(passportExists[passportHash], "tourist missing");
        Tourist storage t = tourists[passportHash];
        if (account != t.account) {
            if (t.account != address(0)) {
                accountToPassport[t.account] = bytes32(0);
            }
            if (account != address(0)) {
                require(accountToPassport[account] == bytes32(0), "wallet linked");
                accountToPassport[account] = passportHash;
            }
            t.account = account;
        }
        if (bytes(name).length > 0) {
            t.name = name;
        }
        t.metadataURI = metadataURI;
        t.active = active;
        emit TouristUpdated(t.account, passportHash, t.name, t.metadataURI, t.active);
        _recordAudit("TOURIST_UPDATE", passportHash, metadataURI);
    }

    function setTouristStatus(bytes32 passportHash, bool active) external onlyOperator {
        require(passportExists[passportHash], "tourist missing");
        Tourist storage t = tourists[passportHash];
        t.active = active;
        emit TouristUpdated(t.account, passportHash, t.name, t.metadataURI, t.active);
        _recordAudit("TOURIST_STATUS", passportHash, active ? "active" : "inactive");
    }

    function createGroup(string calldata groupId) external onlyOperator returns (bytes32) {
        return _createGroup(groupId, "");
    }

    function createGroup(string calldata groupId, string calldata metadataURI) external onlyOperator returns (bytes32) {
        return _createGroup(groupId, metadataURI);
    }

    function updateGroup(string calldata groupId, bool active, string calldata metadataURI) external onlyOperator {
        bytes32 key = _groupKey(groupId);
        TourGroup storage group = tourGroups[key];
        require(group.creationDate != 0, "group missing");
        group.active = active;
        group.metadataURI = metadataURI;
        emit GroupUpdated(groupId, active, metadataURI);
        _recordAudit("GROUP_UPDATE", key, metadataURI);
    }

    function addGroupMember(
        string calldata groupId,
        bytes32 passportHash,
        address account,
        string calldata role
    ) external onlyOperator {
        bytes32 key = _groupKey(groupId);
        TourGroup storage group = tourGroups[key];
        require(group.creationDate != 0, "group missing");
        require(group.active, "group inactive");
        require(passportExists[passportHash], "tourist missing");
        require(!groupPassportMembership[key][passportHash], "member exists");

        Tourist storage t = tourists[passportHash];
        address memberAccount = account;
        if (memberAccount == address(0)) {
            memberAccount = t.account;
        }

        groupMembers[key].push(GroupMember({
            passportHash: passportHash,
            account: memberAccount,
            joinedAt: block.timestamp,
            role: role
        }));

        groupPassportMembership[key][passportHash] = true;
        if (memberAccount != address(0)) {
            groupAccountMembership[key][memberAccount] = true;
        }

        emit GroupMemberAdded(groupId, passportHash, memberAccount, role);
        bytes32 subject = keccak256(abi.encodePacked("GROUP_MEMBER", key, passportHash));
        _recordAudit("GROUP_MEMBER_ADD", subject, groupId);
    }

    function removeGroupMember(string calldata groupId, bytes32 passportHash) external onlyOperator {
        bytes32 key = _groupKey(groupId);
        TourGroup storage group = tourGroups[key];
        require(group.creationDate != 0, "group missing");
        require(groupPassportMembership[key][passportHash], "member missing");

        GroupMember[] storage members = groupMembers[key];
        uint256 len = members.length;
        for (uint256 i = 0; i < len; i++) {
            if (members[i].passportHash == passportHash) {
                address memberAccount = members[i].account;
                if (memberAccount != address(0)) {
                    groupAccountMembership[key][memberAccount] = false;
                }
                members[i] = members[len - 1];
                members.pop();
                groupPassportMembership[key][passportHash] = false;
                emit GroupMemberRemoved(groupId, passportHash, memberAccount);
                bytes32 subject = keccak256(abi.encodePacked("GROUP_MEMBER", key, passportHash));
                _recordAudit("GROUP_MEMBER_REMOVE", subject, groupId);
                return;
            }
        }
        revert("member missing");
    }

    function isGroupMember(string calldata groupId, bytes32 passportHash) external view returns (bool) {
        return groupPassportMembership[_groupKey(groupId)][passportHash];
    }

    function getGroup(string calldata groupId) external view returns (TourGroup memory) {
        return tourGroups[_groupKey(groupId)];
    }

    function getGroupMembers(string calldata groupId) external view returns (GroupMember[] memory) {
        bytes32 key = _groupKey(groupId);
        GroupMember[] storage members = groupMembers[key];
        GroupMember[] memory copy = new GroupMember[](members.length);
        for (uint256 i = 0; i < members.length; i++) {
            copy[i] = members[i];
        }
        return copy;
    }

    function logAlert(
        bytes32 passportHash,
        string calldata location,
        uint8 severity,
        string calldata metadataURI
    ) external onlyOperator returns (uint256) {
        require(passportExists[passportHash], "tourist missing");
        require(bytes(location).length > 0, "location required");
        uint256 alertId = nextAlertId++;
        alerts[alertId] = Alert({
            id: alertId,
            passportHash: passportHash,
            raisedBy: msg.sender,
            timestamp: block.timestamp,
            location: location,
            severity: severity,
            metadataURI: metadataURI
        });
        alertIdsByPassport[passportHash].push(alertId);
        emit AlertLogged(alertId, passportHash, msg.sender, location, severity, metadataURI);
        bytes32 subject = keccak256(abi.encodePacked("ALERT", alertId, passportHash));
        _recordAudit("ALERT_LOG", subject, metadataURI);
        return alertId;
    }

    function getAlert(uint256 alertId) external view returns (Alert memory) {
        return alerts[alertId];
    }

    function getAlertCount() external view returns (uint256) {
        return nextAlertId - 1;
    }

    function getAlertsForPassport(bytes32 passportHash) external view returns (Alert[] memory) {
        uint256[] storage ids = alertIdsByPassport[passportHash];
        Alert[] memory result = new Alert[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = alerts[ids[i]];
        }
        return result;
    }

    function logEmergency(
        bytes32 passportHash,
        string calldata evidenceHash,
        string calldata location,
        string calldata metadataURI
    ) external onlyOperator returns (uint256) {
        require(passportExists[passportHash], "tourist missing");
        require(bytes(evidenceHash).length > 0, "evidence required");
        uint256 logId = nextEmergencyLogId++;
        emergencyLogs[logId] = EmergencyLog({
            id: logId,
            passportHash: passportHash,
            reportedBy: msg.sender,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            location: location,
            metadataURI: metadataURI
        });
        emergencyIdsByPassport[passportHash].push(logId);
        emit EmergencyLogged(logId, passportHash, msg.sender, evidenceHash, location, metadataURI);
        bytes32 subject = keccak256(abi.encodePacked("EMERGENCY", logId, passportHash));
        _recordAudit("EMERGENCY_LOG", subject, metadataURI);
        return logId;
    }

    function getEmergencyLog(uint256 logId) external view returns (EmergencyLog memory) {
        return emergencyLogs[logId];
    }

    function getEmergencyLogCount() external view returns (uint256) {
        return nextEmergencyLogId - 1;
    }

    function getEmergencyLogsForPassport(bytes32 passportHash) external view returns (EmergencyLog[] memory) {
        uint256[] storage ids = emergencyIdsByPassport[passportHash];
        EmergencyLog[] memory result = new EmergencyLog[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = emergencyLogs[ids[i]];
        }
        return result;
    }

    function recordAudit(
        string calldata action,
        bytes32 subject,
        string calldata details
    ) external onlyOperator returns (uint256) {
        return _recordAudit(action, subject, details);
    }

    function getAuditEntry(uint256 auditId) external view returns (AuditEntry memory) {
        return auditEntries[auditId];
    }

    function getAuditCount() external view returns (uint256) {
        return nextAuditId - 1;
    }

    function _registerTourist(
        address account,
        string memory name,
        bytes32 passportHash,
        string memory metadataURI,
        bool active
    ) internal returns (bytes32) {
        require(passportHash != bytes32(0), "invalid hash");
        require(bytes(name).length > 0, "name required");
        require(!passportExists[passportHash], "tourist exists");
        if (account != address(0)) {
            require(accountToPassport[account] == bytes32(0), "wallet linked");
            accountToPassport[account] = passportHash;
        }

        tourists[passportHash] = Tourist({
            name: name,
            passportHash: passportHash,
            account: account,
            issuer: msg.sender,
            registrationDate: block.timestamp,
            active: active,
            metadataURI: metadataURI
        });

        passportExists[passportHash] = true;

        emit TouristRegistered(account, passportHash, name, metadataURI);
        _recordAudit("TOURIST_REGISTER", passportHash, metadataURI);
        return passportHash;
    }

    function _groupKey(string memory groupId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(groupId));
    }

    function _createGroup(string memory groupId, string memory metadataURI) internal returns (bytes32) {
        require(bytes(groupId).length > 0, "group id required");
        bytes32 key = _groupKey(groupId);
        require(tourGroups[key].creationDate == 0, "group exists");
        tourGroups[key] = TourGroup({
            groupId: groupId,
            creator: msg.sender,
            creationDate: block.timestamp,
            active: true,
            metadataURI: metadataURI
        });
        emit GroupCreated(groupId, msg.sender, metadataURI);
        _recordAudit("GROUP_CREATE", key, metadataURI);
        return key;
    }

    function _recordAudit(string memory action, bytes32 subject, string memory details) internal returns (uint256) {
        uint256 auditId = nextAuditId++;
        auditEntries[auditId] = AuditEntry({
            id: auditId,
            timestamp: block.timestamp,
            actor: msg.sender,
            action: action,
            subject: subject,
            details: details
        });
        emit AuditRecorded(auditId, msg.sender, action, subject, details);
        return auditId;
    }
}
