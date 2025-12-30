// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AdviceNotary
/// @notice Блокчейн-нотариат для фиксации рекомендаций LLM-ассистентов
contract AdviceNotary {
    struct Record {
        address author;      // кто зафиксировал
        uint64  timestamp;   // когда
        bytes32 metaHash;    // хеш метаданных (модель, параметры и т.п.)
        string  uri;         // ссылка на документ (IPFS/URL)
        bool    exists;
    }

    mapping(bytes32 => Record) private records;

    event RecordRegistered(
        bytes32 indexed recordHash,
        address indexed author,
        uint64 timestamp,
        bytes32 metaHash,
        string uri
    );

    /// @notice Регистрирует хеш документа
    function register(
        bytes32 recordHash,
        bytes32 metaHash,
        string calldata uri
    ) external {
        require(recordHash != bytes32(0), "EMPTY_HASH");
        require(!records[recordHash].exists, "ALREADY_EXISTS");

        records[recordHash] = Record({
            author: msg.sender,
            timestamp: uint64(block.timestamp),
            metaHash: metaHash,
            uri: uri,
            exists: true
        });

        emit RecordRegistered(
            recordHash,
            msg.sender,
            uint64(block.timestamp),
            metaHash,
            uri
        );
    }

    /// @notice Получить информацию по хешу
    function get(bytes32 recordHash)
        external
        view
        returns (
            address author,
            uint64 timestamp,
            bytes32 metaHash,
            string memory uri,
            bool exists
        )
    {
        Record storage r = records[recordHash];
        return (r.author, r.timestamp, r.metaHash, r.uri, r.exists);
    }
}
