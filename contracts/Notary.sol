// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Notary {
    struct Record {
        address author;
        uint256 timestamp;
        bool exists;
    }

    mapping(bytes32 => Record) private records;

    event Notarized(bytes32 indexed hash, address indexed author, uint256 timestamp);

    function notarize(bytes32 hash) external {
        require(hash != bytes32(0), "Empty hash");
        require(!records[hash].exists, "Already notarized");

        records[hash] = Record({
            author: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });

        emit Notarized(hash, msg.sender, block.timestamp);
    }

    function isNotarized(bytes32 hash) external view returns (bool) {
        return records[hash].exists;
    }

    function getRecord(bytes32 hash) external view returns (address author, uint256 timestamp, bool exists) {
        Record memory r = records[hash];
        return (r.author, r.timestamp, r.exists);
    }
}
