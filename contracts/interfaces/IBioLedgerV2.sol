// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBioLedgerV2 {

    struct SemVer {
        uint16 major;
        uint16 minor;
        uint16 patch;
    }

    struct DatasetVersion {
        bytes32 datasetHash;
        SemVer  version;
        uint256 timestamp;
        string  metadataURI;
        address registeredBy;
        bool    active;
        bool    exists;
    }

    struct ModelVersion {
        bytes32 modelCommitment;
        bytes32 modelArtifactHash;
        bytes32 datasetHash;
        SemVer  version;
        uint256 timestamp;
        string  metadataURI;
        address registeredBy;
        bool    active;
        bool    exists;
    }

    struct InferenceRecord {
        bytes32 inferenceId;
        bytes32 modelCommitment;
        bytes32 inputHash;
        bytes32 outputHash;
        uint256 timestamp;
        address calledBy;
        bool    exists;
    }

    struct BatchCommitment {
        bytes32 batchRoot;
        bytes32 modelCommitment;
        uint256 inferenceCount;
        uint256 timestamp;
        address submittedBy;
        bool    exists;
    }

    event DatasetRegistered(
        bytes32 indexed datasetHash,
        uint16 major, uint16 minor, uint16 patch,
        uint256 timestamp,
        address indexed registeredBy,
        string metadataURI
    );
    event DatasetActivated(bytes32 indexed datasetHash, address indexed activatedBy);

    event ModelRegistered(
        bytes32 indexed modelCommitment,
        bytes32 indexed datasetHash,
        bytes32 modelArtifactHash,
        uint16 major, uint16 minor, uint16 patch,
        uint256 timestamp,
        address indexed registeredBy,
        string metadataURI
    );
    event ModelActivated(bytes32 indexed modelCommitment, address indexed activatedBy);

    event InferenceLogged(
        bytes32 indexed inferenceId,
        bytes32 indexed modelCommitment,
        bytes32 inputHash,
        bytes32 outputHash,
        uint256 timestamp,
        address indexed calledBy
    );

    event BatchCommitted(
        bytes32 indexed batchId,
        bytes32 indexed modelCommitment,
        bytes32 batchRoot,
        uint256 inferenceCount,
        uint256 timestamp,
        address indexed submittedBy
    );

    function registerDataset(bytes32 datasetHash, uint16 major, uint16 minor, uint16 patch, string calldata metadataURI) external;
    function activateDataset(bytes32 datasetHash) external;
    function registerModel(bytes32 modelCommitment, bytes32 modelArtifactHash, bytes32 datasetHash, uint16 major, uint16 minor, uint16 patch, string calldata metadataURI) external;
    function activateModel(bytes32 modelCommitment) external;
    function logInference(bytes32 modelCommitment, bytes32 inputHash, bytes32 outputHash) external returns (bytes32 inferenceId);
    function commitBatch(bytes32 modelCommitment, bytes32 batchRoot, uint256 inferenceCount) external returns (bytes32 batchId);
    function getLineage(bytes32 inferenceId) external view returns (InferenceRecord memory, ModelVersion memory, DatasetVersion memory);
}