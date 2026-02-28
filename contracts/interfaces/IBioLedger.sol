// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBioLedger {

    struct DatasetVersion {
        bytes32 datasetHash;
        uint256 version;
        uint256 timestamp;
        string  metadataURI;
        address registeredBy;
        bool    exists;
    }

    struct ModelVersion {
        bytes32 modelHash;
        bytes32 datasetHash;
        uint256 version;
        uint256 timestamp;
        string  metadataURI;
        address registeredBy;
        bool    exists;
    }

    struct InferenceRecord {
        bytes32 inferenceId;
        bytes32 modelHash;
        bytes32 inputHash;
        bytes32 outputHash;
        uint256 timestamp;
        address calledBy;
        bool    exists;
    }

    event DatasetVersionRegistered(
        bytes32 indexed datasetHash,
        uint256 version,
        uint256 timestamp,
        address indexed registeredBy,
        string  metadataURI
    );

    event ModelVersionRegistered(
        bytes32 indexed modelHash,
        bytes32 indexed datasetHash,
        uint256 version,
        uint256 timestamp,
        address indexed registeredBy,
        string  metadataURI
    );

    event InferenceLogged(
        bytes32 indexed inferenceId,
        bytes32 indexed modelHash,
        bytes32 inputHash,
        bytes32 outputHash,
        uint256 timestamp,
        address indexed calledBy
    );

    function registerDatasetVersion(bytes32 datasetHash, string calldata metadataURI) external;

    function registerModelVersion(
        bytes32 modelHash,
        bytes32 datasetHash,
        string calldata metadataURI
    ) external;

    function logInference(
        bytes32 modelHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) external returns (bytes32 inferenceId);

    function getDataset(bytes32 datasetHash)     external view returns (DatasetVersion memory);
    function getModel(bytes32 modelHash)         external view returns (ModelVersion memory);
    function getInference(bytes32 inferenceId)   external view returns (InferenceRecord memory);

    function getLineage(bytes32 inferenceId)
        external view
        returns (
            InferenceRecord memory inference,
            ModelVersion    memory model,
            DatasetVersion  memory dataset
        );
}