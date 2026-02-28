// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IBioLedger.sol";

/**
 * @title BioLedger
 * @notice Cryptographic lineage registry for dataset versions, model versions,
 *         and inference records. No raw biometric data stored on-chain.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE  — grant/revoke roles, pause/unpause
 *   REGISTRAR_ROLE      — all write functions (pipeline wallet)
 *   GOVERNANCE_ROLE     — granted to BioDAO; executes privileged ops via vote
 */
contract BioLedger is IBioLedger, AccessControl, Pausable {

    bytes32 public constant REGISTRAR_ROLE  = keccak256("REGISTRAR_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    mapping(bytes32 => DatasetVersion)  private _datasets;
    mapping(bytes32 => ModelVersion)    private _models;
    mapping(bytes32 => InferenceRecord) private _inferences;
    mapping(bytes32 => uint256)         private _modelNonce;

    uint256 public datasetCount;
    uint256 public modelCount;
    uint256 public inferenceCount;

    constructor(address admin) {
        require(admin != address(0), "BioLedger: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE,     admin);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Dataset ────────────────────────────────────────────────────────────────

    function registerDatasetVersion(
        bytes32        datasetHash,
        string calldata metadataURI
    )
        external override
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
    {
        require(datasetHash != bytes32(0),      "BioLedger: zero dataset hash");
        require(!_datasets[datasetHash].exists, "BioLedger: dataset already registered");

        uint256 version = ++datasetCount;

        _datasets[datasetHash] = DatasetVersion({
            datasetHash:  datasetHash,
            version:      version,
            timestamp:    block.timestamp,
            metadataURI:  metadataURI,
            registeredBy: msg.sender,
            exists:       true
        });

        emit DatasetVersionRegistered(datasetHash, version, block.timestamp, msg.sender, metadataURI);
    }

    // ── Model ──────────────────────────────────────────────────────────────────

    function registerModelVersion(
        bytes32        modelHash,
        bytes32        datasetHash,
        string calldata metadataURI
    )
        external override
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
    {
        require(modelHash   != bytes32(0),     "BioLedger: zero model hash");
        require(datasetHash != bytes32(0),     "BioLedger: zero dataset hash");
        require(_datasets[datasetHash].exists, "BioLedger: dataset not registered");
        require(!_models[modelHash].exists,    "BioLedger: model already registered");

        uint256 version = ++modelCount;

        _models[modelHash] = ModelVersion({
            modelHash:    modelHash,
            datasetHash:  datasetHash,
            version:      version,
            timestamp:    block.timestamp,
            metadataURI:  metadataURI,
            registeredBy: msg.sender,
            exists:       true
        });

        emit ModelVersionRegistered(modelHash, datasetHash, version, block.timestamp, msg.sender, metadataURI);
    }

    // ── Inference ──────────────────────────────────────────────────────────────

    function logInference(
        bytes32 modelHash,
        bytes32 inputHash,
        bytes32 outputHash
    )
        external override
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (bytes32 inferenceId)
    {
        require(modelHash  != bytes32(0),  "BioLedger: zero model hash");
        require(inputHash  != bytes32(0),  "BioLedger: zero input hash");
        require(outputHash != bytes32(0),  "BioLedger: zero output hash");
        require(_models[modelHash].exists, "BioLedger: model not registered");

        uint256 nonce = _modelNonce[modelHash]++;

        inferenceId = keccak256(
            abi.encodePacked(modelHash, inputHash, block.timestamp, nonce)
        );

        require(!_inferences[inferenceId].exists, "BioLedger: inference ID collision");

        _inferences[inferenceId] = InferenceRecord({
            inferenceId: inferenceId,
            modelHash:   modelHash,
            inputHash:   inputHash,
            outputHash:  outputHash,
            timestamp:   block.timestamp,
            calledBy:    msg.sender,
            exists:      true
        });

        inferenceCount++;

        emit InferenceLogged(inferenceId, modelHash, inputHash, outputHash, block.timestamp, msg.sender);
    }

    // ── Read ───────────────────────────────────────────────────────────────────

    function getDataset(bytes32 datasetHash)
        external view override returns (DatasetVersion memory)
    {
        require(_datasets[datasetHash].exists, "BioLedger: dataset not found");
        return _datasets[datasetHash];
    }

    function getModel(bytes32 modelHash)
        external view override returns (ModelVersion memory)
    {
        require(_models[modelHash].exists, "BioLedger: model not found");
        return _models[modelHash];
    }

    function getInference(bytes32 inferenceId)
        external view override returns (InferenceRecord memory)
    {
        require(_inferences[inferenceId].exists, "BioLedger: inference not found");
        return _inferences[inferenceId];
    }

    function getLineage(bytes32 inferenceId)
        external view override
        returns (
            InferenceRecord memory inference,
            ModelVersion    memory model,
            DatasetVersion  memory dataset
        )
    {
        inference = _inferences[inferenceId];
        require(inference.exists, "BioLedger: inference not found");

        model = _models[inference.modelHash];
        require(model.exists, "BioLedger: model not found");

        dataset = _datasets[model.datasetHash];
        require(dataset.exists, "BioLedger: dataset not found");
    }

    function datasetExists(bytes32 datasetHash) external view returns (bool) {
        return _datasets[datasetHash].exists;
    }

    function modelExists(bytes32 modelHash) external view returns (bool) {
        return _models[modelHash].exists;
    }

    function inferenceExists(bytes32 inferenceId) external view returns (bool) {
        return _inferences[inferenceId].exists;
    }
}