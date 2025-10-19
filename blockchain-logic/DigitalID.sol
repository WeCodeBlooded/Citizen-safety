// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DigitalID {
    // Blueprint for an individual tourist
    struct Tourist {
        string name;
        string passportId;
        address walletAddress;
        uint256 registrationDate;
    }

    struct EmergencyLog {
        uint256 timestamp;
        string passportId;
        string evidenceHash; // To store a hash of the audio/video evidence
        string location;
    }

    // NEW: Blueprint for a tour group
    struct TourGroup {
        string groupId; // The unique ID from our backend
        address creator;
        uint256 creationDate;
    }

    struct Alert {
    string passportId;
    uint256 timestamp;
    string location; // e.g., "lat,long"
}

    // Mapping for individual tourists
    mapping(address => Tourist) public tourists;
    // NEW: Mapping for tour groups, linking group ID string to the struct
    mapping(string => TourGroup) public tourGroups;
    mapping(uint256 => Alert) public alerts;
    uint256 public alertCount;
    mapping(uint256 => EmergencyLog) public emergencyLogs;
    uint256 public emergencyLogCount;

    function createId(string memory _name, string memory _passportId) public {
        address sender = msg.sender;
        require(tourists[sender].walletAddress == address(0), "ID already exists.");
        tourists[sender] = Tourist({
            name: _name,
            passportId: _passportId,
            walletAddress: sender,
            registrationDate: block.timestamp
        });
    }

    // NEW: Function to create and "mint" a new group on the blockchain
    function createGroup(string memory _groupId) public {
        // Ensure the group doesn't already exist on-chain
        require(tourGroups[_groupId].creationDate == 0, "Group ID already exists.");

        tourGroups[_groupId] = TourGroup({
            groupId: _groupId,
            creator: msg.sender,
            creationDate: block.timestamp
        });
    }

    function logAlert(string memory _passportId, string memory _location) public {
        alertCount++;
        alerts[alertCount] = Alert({
            passportId: _passportId,
            timestamp: block.timestamp,
            location: _location
        });
    }

    function logEmergency(string memory _passportId, string memory _evidenceHash, string memory _location) public {
        emergencyLogCount++;
        emergencyLogs[emergencyLogCount] = EmergencyLog({
            timestamp: block.timestamp,
            passportId: _passportId,
            evidenceHash: _evidenceHash,
            location: _location
        });
    }
}