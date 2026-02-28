// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IBioLedgerV2.sol";

/**
 * @title BioLedgerV2
 * @notice Upgraded cryptographic lineage registry for the BioLedger AI pipeline.
 *
 * Role Model:
 *   DEFAULT_ADMIN_ROLE     Grant/revoke all roles. Pause/unpause.
 *   DATA_CONTRIBUTOR_ROLE  Register dataset versions.
 *   MODEL_TRAINER_ROLE     Register model versions.
 *   VALIDATOR_ROLE         Activate datasets and models after review.
 *   REGISTRAR_ROLE         Log inference records.
 *   GOVERNANCE_ROLE        Held by BioDAO. Executes passed proposals.
 *
 * Activation Gating:
 *   Registered != Active.
 *   Dataset/model is REGISTERED when hash is anchored on-chain.
 *   Becomes ACTIVE only when VALIDATOR_ROLE calls activate*().
 *   logInference() requires an ACTIVE model backed by an ACTIVE dataset.
 *
 * modelCommitment:
 *   keccak256(artifactHash + scriptHash + hyperparamsHash + environmentHash)
 *   Binds the model to exact environment. Any change = new commitment.
 *
 * Replay Protection:
 *   inferenceId = keccak256(modelCommitment, inputHash, msg.sender, block.timestamp)
 *   Non-deterministic by design — same input at different times produces
 *   distinct auditable records. Caller + timestamp = replay protection.
 *
 * Batch Commitments:
 *   commitBatch() stores Merkle root of N inferences in one tx.
 *   Individual proofs kept off-chain. O(1) on-chain cost per batch.
 *
 * Gas Optimisations (v2.1):
 *   logInference  — single storage load for model exists + active check.
 *   commitBatch   — single storage load for model exists + active check.
 *   registerModel — single storage load for dataset exists + active check.
 */
contract BioLedgerV2 is IBioLedgerV2, AccessControl, Pausable, ReentrancyGuard {

    // ── Roles ──────────────────────────────────────────────────────────────────
    bytes32 public constant DATA_CONTRIBUTOR_ROLE = keccak256("DATA_CONTRIBUTOR_ROLE");
    bytes32 public constant MODEL_TRAINER_ROLE    = keccak256("MODEL_TRAINER_ROLE");
    bytes32 public constant VALIDATOR_ROLE        = keccak256("VALIDATOR_ROLE");
    bytes32 public constant REGISTRAR_ROLE        = keccak256("REGISTRAR_ROLE");
    bytes32 public constant GOVERNANCE_ROLE       = keccak256("GOVERNANCE_ROLE");

    // ── Storage ────────────────────────────────────────────────────────────────
    mapping(bytes32 => DatasetVersion)  private _datasets;
    mapping(bytes32 => ModelVersion)    private _models;
    mapping(bytes32 => InferenceRecord) private _inferences;
    mapping(bytes32 => BatchCommitment) private _batches;

    uint256 public datasetCount;
    uint256 public modelCount;
    uint256 public inferenceCount;
    uint256 public batchCount;

    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(address admin) {
        require(admin != address(0), "BioLedgerV2: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE,      admin);
        _grantRole(DATA_CONTRIBUTOR_ROLE,   admin);
        _grantRole(MODEL_TRAINER_ROLE,      admin);
        _grantRole(VALIDATOR_ROLE,          admin);
        _grantRole(REGISTRAR_ROLE,          admin);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────
    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Dataset: Register ──────────────────────────────────────────────────────
    function registerDataset(
        bytes32         datasetHash,
        uint16          major,
        uint16          minor,
        uint16          patch,
        string calldata metadataURI
    )
        external override
        onlyRole(DATA_CONTRIBUTOR_ROLE)
        whenNotPaused
    {
        require(datasetHash != bytes32(0),      "BioLedgerV2: zero dataset hash");
        require(!_datasets[datasetHash].exists, "BioLedgerV2: dataset already registered");

        datasetCount++;

        _datasets[datasetHash] = DatasetVersion({
            datasetHash:  datasetHash,
            version:      SemVer(major, minor, patch),
            timestamp:    block.timestamp,
            metadataURI:  metadataURI,
            registeredBy: msg.sender,
            active:       false,
            exists:       true
        });

        emit DatasetRegistered(
            datasetHash, major, minor, patch,
            block.timestamp, msg.sender, metadataURI
        );
    }

    // ── Dataset: Activate ──────────────────────────────────────────────────────
    function activateDataset(bytes32 datasetHash)
        external override
        onlyRole(VALIDATOR_ROLE)
        whenNotPaused
    {
        DatasetVersion storage ds = _datasets[datasetHash];
        require(ds.exists,  "BioLedgerV2: dataset not registered");
        require(!ds.active, "BioLedgerV2: dataset already active");
        ds.active = true;
        emit DatasetActivated(datasetHash, msg.sender);
    }

    // ── Model: Register ────────────────────────────────────────────────────────
    function registerModel(
        bytes32         modelCommitment,
        bytes32         modelArtifactHash,
        bytes32         datasetHash,
        uint16          major,
        uint16          minor,
        uint16          patch,
        string calldata metadataURI
    )
        external override
        onlyRole(MODEL_TRAINER_ROLE)
        whenNotPaused
    {
        require(modelCommitment   != bytes32(0), "BioLedgerV2: zero commitment");
        require(modelArtifactHash != bytes32(0), "BioLedgerV2: zero artifact hash");
        require(datasetHash       != bytes32(0), "BioLedgerV2: zero dataset hash");

        // Single storage load for both dataset checks
        DatasetVersion storage ds = _datasets[datasetHash];
        require(ds.exists, "BioLedgerV2: dataset not registered");
        require(ds.active, "BioLedgerV2: dataset not active");

        require(!_models[modelCommitment].exists, "BioLedgerV2: model already registered");

        modelCount++;

        _models[modelCommitment] = ModelVersion({
            modelCommitment:   modelCommitment,
            modelArtifactHash: modelArtifactHash,
            datasetHash:       datasetHash,
            version:           SemVer(major, minor, patch),
            timestamp:         block.timestamp,
            metadataURI:       metadataURI,
            registeredBy:      msg.sender,
            active:            false,
            exists:            true
        });

        emit ModelRegistered(
            modelCommitment, datasetHash, modelArtifactHash,
            major, minor, patch,
            block.timestamp, msg.sender, metadataURI
        );
    }

    // ── Model: Activate ────────────────────────────────────────────────────────
    function activateModel(bytes32 modelCommitment)
        external override
        onlyRole(VALIDATOR_ROLE)
        whenNotPaused
    {
        ModelVersion storage m = _models[modelCommitment];
        require(m.exists,  "BioLedgerV2: model not registered");
        require(!m.active, "BioLedgerV2: model already active");
        m.active = true;
        emit ModelActivated(modelCommitment, msg.sender);
    }

    // ── Inference: Log ─────────────────────────────────────────────────────────
    function logInference(
        bytes32 modelCommitment,
        bytes32 inputHash,
        bytes32 outputHash
    )
        external override
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 inferenceId)
    {
        require(modelCommitment != bytes32(0), "BioLedgerV2: zero commitment");
        require(inputHash       != bytes32(0), "BioLedgerV2: zero input hash");
        require(outputHash      != bytes32(0), "BioLedgerV2: zero output hash");

        // Single storage load for both model checks — saves ~2100 gas (one cold SLOAD)
        ModelVersion storage m = _models[modelCommitment];
        require(m.exists, "BioLedgerV2: model not registered");
        require(m.active, "BioLedgerV2: model not active");

        inferenceId = keccak256(
            abi.encodePacked(modelCommitment, inputHash, msg.sender, block.timestamp)
        );

        require(!_inferences[inferenceId].exists, "BioLedgerV2: inference ID collision");

        _inferences[inferenceId] = InferenceRecord({
            inferenceId:     inferenceId,
            modelCommitment: modelCommitment,
            inputHash:       inputHash,
            outputHash:      outputHash,
            timestamp:       block.timestamp,
            calledBy:        msg.sender,
            exists:          true
        });

        inferenceCount++;

        emit InferenceLogged(
            inferenceId, modelCommitment,
            inputHash, outputHash,
            block.timestamp, msg.sender
        );
    }

    // ── Batch Commitment ───────────────────────────────────────────────────────
    function commitBatch(
        bytes32 modelCommitment,
        bytes32 batchRoot,
        uint256 inferenceCount_
    )
        external override
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 batchId)
    {
        require(modelCommitment != bytes32(0), "BioLedgerV2: zero commitment");
        require(batchRoot       != bytes32(0), "BioLedgerV2: zero batch root");
        require(inferenceCount_ > 0,           "BioLedgerV2: empty batch");

        // Single storage load for both model checks — saves ~2100 gas (one cold SLOAD)
        ModelVersion storage m = _models[modelCommitment];
        require(m.exists, "BioLedgerV2: model not registered");
        require(m.active, "BioLedgerV2: model not active");

        batchId = keccak256(
            abi.encodePacked(modelCommitment, batchRoot, inferenceCount_, block.timestamp)
        );

        require(!_batches[batchId].exists, "BioLedgerV2: batch ID collision");

        _batches[batchId] = BatchCommitment({
            batchRoot:       batchRoot,
            modelCommitment: modelCommitment,
            inferenceCount:  inferenceCount_,
            timestamp:       block.timestamp,
            submittedBy:     msg.sender,
            exists:          true
        });

        batchCount++;

        emit BatchCommitted(
            batchId, modelCommitment, batchRoot,
            inferenceCount_, block.timestamp, msg.sender
        );
    }

    // ── ZK Placeholder ─────────────────────────────────────────────────────────
    /**
     * @notice ZK proof verification hook. No-op placeholder.
     *         Replace body with Groth16/PLONK verifier without changing interface.
     */
    function verifyZKProof(bytes32 inferenceId, bytes calldata zkProof)
        external view
        returns (bool)
    {
        require(_inferences[inferenceId].exists, "BioLedgerV2: inference not found");
        zkProof;
        return true;
    }

    // ── Read ───────────────────────────────────────────────────────────────────
    function getDataset(bytes32 datasetHash)
        external view returns (DatasetVersion memory)
    {
        require(_datasets[datasetHash].exists, "BioLedgerV2: dataset not found");
        return _datasets[datasetHash];
    }

    function getModel(bytes32 modelCommitment)
        external view returns (ModelVersion memory)
    {
        require(_models[modelCommitment].exists, "BioLedgerV2: model not found");
        return _models[modelCommitment];
    }

    function getInference(bytes32 inferenceId)
        external view returns (InferenceRecord memory)
    {
        require(_inferences[inferenceId].exists, "BioLedgerV2: inference not found");
        return _inferences[inferenceId];
    }

    function getBatch(bytes32 batchId)
        external view returns (BatchCommitment memory)
    {
        require(_batches[batchId].exists, "BioLedgerV2: batch not found");
        return _batches[batchId];
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
        require(inference.exists, "BioLedgerV2: inference not found");
        model = _models[inference.modelCommitment];
        require(model.exists, "BioLedgerV2: model not found");
        dataset = _datasets[model.datasetHash];
        require(dataset.exists, "BioLedgerV2: dataset not found");
    }

    // ── View helpers ───────────────────────────────────────────────────────────
    function datasetExists(bytes32 h)   external view returns (bool) { return _datasets[h].exists; }
    function datasetIsActive(bytes32 h) external view returns (bool) { return _datasets[h].active; }
    function modelExists(bytes32 h)     external view returns (bool) { return _models[h].exists; }
    function modelIsActive(bytes32 h)   external view returns (bool) { return _models[h].active; }
    function inferenceExists(bytes32 h) external view returns (bool) { return _inferences[h].exists; }
}