/**
 * BioLedger.test.js
 * Test suite for BioLedgerV2.sol
 *
 * Requires:
 *   npm install --save-dev @nomicfoundation/hardhat-chai-matchers
 *   (already included if you used the standard Hardhat template)
 *
 * Run:
 *   npx hardhat test
 *   npx hardhat test --grep "logInference"   # run one suite
 */

const { expect }   = require("chai");
const { ethers }   = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// ── Fixed test vectors ────────────────────────────────────────────────────────
// encodeBytes32String is ethers v6 — replaces formatBytes32String from v5
const DATASET_HASH  = ethers.encodeBytes32String("test-dataset-v1");
const MODEL_COMMIT  = ethers.encodeBytes32String("test-model-commit");
const ARTIFACT_HASH = ethers.encodeBytes32String("test-artifact-v1");
const ALT_DATASET   = ethers.encodeBytes32String("alt-dataset-v2");
const ALT_MODEL     = ethers.encodeBytes32String("alt-model-commit");
const ALT_ARTIFACT  = ethers.encodeBytes32String("alt-artifact-v2");
const INPUT_HASH    = ethers.encodeBytes32String("face-img-hash-001");
const OUTPUT_HASH   = ethers.encodeBytes32String("trust-score-82-v1");
const METADATA_URI  = "ipfs://QmTestMetadataHash";

const MAJOR = 1, MINOR = 0, PATCH = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Wraps the real 5-arg registerDataset(hash, major, minor, patch, metadataURI)
async function ds(contract, hash, uri = "") {
  return contract.registerDataset(hash, MAJOR, MINOR, PATCH, uri);
}

// Wraps the real 7-arg registerModel(commit, artifact, dataset, major, minor, patch, uri)
async function mdl(contract, commit, artifact, dataset, uri = "") {
  return contract.registerModel(commit, artifact, dataset, MAJOR, MINOR, PATCH, uri);
}

// Parse the InferenceLogged event and return inferenceId
async function getInferenceId(contract, tx) {
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "InferenceLogged") return parsed.args.inferenceId;
    } catch (_) {}
  }
  throw new Error("InferenceLogged event not found in receipt");
}

// Parse the BatchCommitted event and return batchId
async function getBatchId(contract, tx) {
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "BatchCommitted") return parsed.args.batchId;
    } catch (_) {}
  }
  throw new Error("BatchCommitted event not found in receipt");
}

// ─────────────────────────────────────────────────────────────────────────────
describe("BioLedgerV2", function () {

  // Signers assigned to dedicated roles for role-gating tests
  let contract;
  let owner, validator, contributor, trainer, registrar, addr1;

  // Role constants (read from contract so they can't drift)
  let VALIDATOR_ROLE, DATA_CONTRIBUTOR_ROLE, MODEL_TRAINER_ROLE, REGISTRAR_ROLE;

  beforeEach(async function () {
    [owner, validator, contributor, trainer, registrar, addr1] =
      await ethers.getSigners();

    // Deploy — constructor(address admin)
    const Factory = await ethers.getContractFactory("BioLedgerV2");
    contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();

    // Read role constants from contract
    VALIDATOR_ROLE        = await contract.VALIDATOR_ROLE();
    DATA_CONTRIBUTOR_ROLE = await contract.DATA_CONTRIBUTOR_ROLE();
    MODEL_TRAINER_ROLE    = await contract.MODEL_TRAINER_ROLE();
    REGISTRAR_ROLE        = await contract.REGISTRAR_ROLE();

    // Grant individual roles so we can test isolation
    await contract.grantRole(VALIDATOR_ROLE,        validator.address);
    await contract.grantRole(DATA_CONTRIBUTOR_ROLE, contributor.address);
    await contract.grantRole(MODEL_TRAINER_ROLE,    trainer.address);
    await contract.grantRole(REGISTRAR_ROLE,        registrar.address);
  });

  // ── Deployment ──────────────────────────────────────────────────────────────
  describe("Deployment", function () {

    it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
      const ADMIN = await contract.DEFAULT_ADMIN_ROLE();
      expect(await contract.hasRole(ADMIN, owner.address)).to.be.true;
    });

    it("all counters start at zero", async function () {
      expect(await contract.datasetCount()).to.equal(0);
      expect(await contract.modelCount()).to.equal(0);
      expect(await contract.inferenceCount()).to.equal(0);
      expect(await contract.batchCount()).to.equal(0);
    });

    it("reverts if admin address is zero", async function () {
      const Factory = await ethers.getContractFactory("BioLedgerV2");
      await expect(
        Factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("BioLedgerV2: zero admin");
    });

    it("admin holds all roles by default", async function () {
      expect(await contract.hasRole(VALIDATOR_ROLE,        owner.address)).to.be.true;
      expect(await contract.hasRole(DATA_CONTRIBUTOR_ROLE, owner.address)).to.be.true;
      expect(await contract.hasRole(MODEL_TRAINER_ROLE,    owner.address)).to.be.true;
      expect(await contract.hasRole(REGISTRAR_ROLE,        owner.address)).to.be.true;
    });
  });

  // ── Pause / Unpause ─────────────────────────────────────────────────────────
  describe("Pause", function () {

    it("admin can pause — blocks all state-changing calls", async function () {
      await contract.pause();
      await expect(
        ds(contract.connect(owner), DATASET_HASH)
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("admin can unpause — calls succeed again", async function () {
      await contract.pause();
      await contract.unpause();
      await expect(ds(contract.connect(owner), DATASET_HASH)).to.not.be.reverted;
    });

    it("non-admin cannot pause", async function () {
      await expect(contract.connect(addr1).pause()).to.be.reverted;
    });

    it("non-admin cannot unpause", async function () {
      await contract.pause();
      await expect(contract.connect(addr1).unpause()).to.be.reverted;
    });
  });

  // ── Dataset Registration ────────────────────────────────────────────────────
  describe("Dataset Registration", function () {

    it("emits DatasetRegistered with correct args", async function () {
      await expect(ds(contract.connect(owner), DATASET_HASH, METADATA_URI))
        .to.emit(contract, "DatasetRegistered")
        .withArgs(
          DATASET_HASH,
          MAJOR, MINOR, PATCH,
          anyValue,          // block.timestamp — unknown ahead of time
          owner.address,
          METADATA_URI
        );
    });

    it("increments datasetCount", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      expect(await contract.datasetCount()).to.equal(1);
    });

    it("dataset starts inactive", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      expect(await contract.datasetIsActive(DATASET_HASH)).to.be.false;
    });

    it("datasetExists returns true after registration", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      expect(await contract.datasetExists(DATASET_HASH)).to.be.true;
    });

    it("stores correct registeredBy", async function () {
      await ds(contract.connect(contributor), DATASET_HASH);
      const record = await contract.getDataset(DATASET_HASH);
      expect(record.registeredBy).to.equal(contributor.address);
    });

    it("stores metadataURI", async function () {
      await ds(contract.connect(owner), DATASET_HASH, METADATA_URI);
      const record = await contract.getDataset(DATASET_HASH);
      expect(record.metadataURI).to.equal(METADATA_URI);
    });

    it("reverts on duplicate hash", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await expect(
        ds(contract.connect(owner), DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: dataset already registered");
    });

    it("reverts on zero hash", async function () {
      await expect(
        ds(contract.connect(owner), ethers.ZeroHash)
      ).to.be.revertedWith("BioLedgerV2: zero dataset hash");
    });

    it("reverts if caller lacks DATA_CONTRIBUTOR_ROLE", async function () {
      await expect(
        ds(contract.connect(addr1), DATASET_HASH)
      ).to.be.reverted;
    });

    it("allows multiple distinct datasets", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await ds(contract.connect(owner), ALT_DATASET);
      expect(await contract.datasetCount()).to.equal(2);
    });
  });

  // ── Dataset Activation ──────────────────────────────────────────────────────
  describe("Dataset Activation", function () {

    beforeEach(async function () {
      await ds(contract.connect(owner), DATASET_HASH);
    });

    it("VALIDATOR_ROLE can activate and emits DatasetActivated", async function () {
      await expect(contract.connect(validator).activateDataset(DATASET_HASH))
        .to.emit(contract, "DatasetActivated")
        .withArgs(DATASET_HASH, validator.address);
    });

    it("datasetIsActive returns true after activation", async function () {
      await contract.connect(validator).activateDataset(DATASET_HASH);
      expect(await contract.datasetIsActive(DATASET_HASH)).to.be.true;
    });

    it("reverts if dataset not registered", async function () {
      await expect(
        contract.connect(validator).activateDataset(ALT_DATASET)
      ).to.be.revertedWith("BioLedgerV2: dataset not registered");
    });

    it("reverts on double activation", async function () {
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await expect(
        contract.connect(validator).activateDataset(DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: dataset already active");
    });

    it("reverts if caller lacks VALIDATOR_ROLE", async function () {
      await expect(
        contract.connect(addr1).activateDataset(DATASET_HASH)
      ).to.be.reverted;
    });
  });

  // ── Model Registration ──────────────────────────────────────────────────────
  describe("Model Registration", function () {

    beforeEach(async function () {
      // dataset must be registered AND active for model registration to succeed
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
    });

    it("emits ModelRegistered with correct args", async function () {
      await expect(
        mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH, METADATA_URI)
      )
        .to.emit(contract, "ModelRegistered")
        .withArgs(
          MODEL_COMMIT,
          DATASET_HASH,
          ARTIFACT_HASH,
          MAJOR, MINOR, PATCH,
          anyValue,
          owner.address,
          METADATA_URI
        );
    });

    it("increments modelCount", async function () {
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      expect(await contract.modelCount()).to.equal(1);
    });

    it("model starts inactive", async function () {
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      expect(await contract.modelIsActive(MODEL_COMMIT)).to.be.false;
    });

    it("links model to correct dataset and artifact", async function () {
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      const record = await contract.getModel(MODEL_COMMIT);
      expect(record.datasetHash).to.equal(DATASET_HASH);
      expect(record.modelArtifactHash).to.equal(ARTIFACT_HASH);
      expect(record.modelCommitment).to.equal(MODEL_COMMIT);
    });

    it("reverts if dataset is not registered at all", async function () {
      await expect(
        mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, ALT_DATASET)
      ).to.be.revertedWith("BioLedgerV2: dataset not registered");
    });

    it("reverts if dataset is registered but not active", async function () {
      // Register ALT_DATASET but do NOT activate it
      await ds(contract.connect(owner), ALT_DATASET);
      await expect(
        mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, ALT_DATASET)
      ).to.be.revertedWith("BioLedgerV2: dataset not active");
    });

    it("reverts on duplicate model commitment", async function () {
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      await expect(
        mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: model already registered");
    });

    it("reverts on zero model commitment", async function () {
      await expect(
        mdl(contract.connect(owner), ethers.ZeroHash, ARTIFACT_HASH, DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: zero commitment");
    });

    it("reverts on zero artifact hash", async function () {
      await expect(
        mdl(contract.connect(owner), MODEL_COMMIT, ethers.ZeroHash, DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: zero artifact hash");
    });

    it("reverts if caller lacks MODEL_TRAINER_ROLE", async function () {
      await expect(
        mdl(contract.connect(addr1), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH)
      ).to.be.reverted;
    });
  });

  // ── Model Activation ────────────────────────────────────────────────────────
  describe("Model Activation", function () {

    beforeEach(async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
    });

    it("VALIDATOR_ROLE can activate and emits ModelActivated", async function () {
      await expect(contract.connect(validator).activateModel(MODEL_COMMIT))
        .to.emit(contract, "ModelActivated")
        .withArgs(MODEL_COMMIT, validator.address);
    });

    it("modelIsActive returns true after activation", async function () {
      await contract.connect(validator).activateModel(MODEL_COMMIT);
      expect(await contract.modelIsActive(MODEL_COMMIT)).to.be.true;
    });

    it("reverts if model not registered", async function () {
      await expect(
        contract.connect(validator).activateModel(ALT_MODEL)
      ).to.be.revertedWith("BioLedgerV2: model not registered");
    });

    it("reverts on double activation", async function () {
      await contract.connect(validator).activateModel(MODEL_COMMIT);
      await expect(
        contract.connect(validator).activateModel(MODEL_COMMIT)
      ).to.be.revertedWith("BioLedgerV2: model already active");
    });

    it("reverts if caller lacks VALIDATOR_ROLE", async function () {
      await expect(
        contract.connect(addr1).activateModel(MODEL_COMMIT)
      ).to.be.reverted;
    });
  });

  // ── logInference ────────────────────────────────────────────────────────────
  describe("logInference", function () {

    beforeEach(async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      await contract.connect(validator).activateModel(MODEL_COMMIT);
    });

    it("emits InferenceLogged", async function () {
      await expect(
        contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH)
      ).to.emit(contract, "InferenceLogged");
    });

    it("increments inferenceCount", async function () {
      await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      expect(await contract.inferenceCount()).to.equal(1);
    });

    it("returns a non-zero inferenceId", async function () {
      const tx  = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      const id  = await getInferenceId(contract, tx);
      expect(id).to.not.equal(ethers.ZeroHash);
    });

    it("stores inputHash and outputHash on-chain", async function () {
      const tx  = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      const id  = await getInferenceId(contract, tx);
      const rec = await contract.getInference(id);
      expect(rec.inputHash).to.equal(INPUT_HASH);
      expect(rec.outputHash).to.equal(OUTPUT_HASH);
      expect(rec.modelCommitment).to.equal(MODEL_COMMIT);
      expect(rec.calledBy).to.equal(registrar.address);
    });

    it("two calls with same args produce different inferenceIds (timestamp + caller baked in)", async function () {
      // Hardhat auto-mines — different timestamps
      const tx1 = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      const tx2 = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      const id1 = await getInferenceId(contract, tx1);
      const id2 = await getInferenceId(contract, tx2);
      expect(id1).to.not.equal(id2);
    });

    it("reverts on zero model commitment", async function () {
      await expect(
        contract.connect(registrar).logInference(ethers.ZeroHash, INPUT_HASH, OUTPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: zero commitment");
    });

    it("reverts on zero input hash", async function () {
      await expect(
        contract.connect(registrar).logInference(MODEL_COMMIT, ethers.ZeroHash, OUTPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: zero input hash");
    });

    it("reverts on zero output hash", async function () {
      await expect(
        contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, ethers.ZeroHash)
      ).to.be.revertedWith("BioLedgerV2: zero output hash");
    });

    it("reverts if model is registered but not active", async function () {
      // Register a second model without activating it
      await ds(contract.connect(owner), ALT_DATASET);
      await contract.connect(validator).activateDataset(ALT_DATASET);
      await mdl(contract.connect(owner), ALT_MODEL, ALT_ARTIFACT, ALT_DATASET);
      // ALT_MODEL exists but is NOT active
      await expect(
        contract.connect(registrar).logInference(ALT_MODEL, INPUT_HASH, OUTPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: model not active");
    });

    it("reverts if model is not registered at all", async function () {
      await expect(
        contract.connect(registrar).logInference(ALT_MODEL, INPUT_HASH, OUTPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: model not registered");
    });

    it("reverts if caller lacks REGISTRAR_ROLE", async function () {
      await expect(
        contract.connect(addr1).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH)
      ).to.be.reverted;
    });
  });

  // ── commitBatch ─────────────────────────────────────────────────────────────
  describe("commitBatch", function () {

    const BATCH_ROOT = ethers.encodeBytes32String("batch-merkle-root-1");

    beforeEach(async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      await contract.connect(validator).activateModel(MODEL_COMMIT);
    });

    it("emits BatchCommitted", async function () {
      await expect(
        contract.connect(registrar).commitBatch(MODEL_COMMIT, BATCH_ROOT, 50)
      ).to.emit(contract, "BatchCommitted");
    });

    it("increments batchCount", async function () {
      await contract.connect(registrar).commitBatch(MODEL_COMMIT, BATCH_ROOT, 50);
      expect(await contract.batchCount()).to.equal(1);
    });

    it("stores batchRoot and inferenceCount", async function () {
      const tx  = await contract.connect(registrar).commitBatch(MODEL_COMMIT, BATCH_ROOT, 50);
      const id  = await getBatchId(contract, tx);
      const rec = await contract.getBatch(id);
      expect(rec.batchRoot).to.equal(BATCH_ROOT);
      expect(rec.inferenceCount).to.equal(50);
      expect(rec.modelCommitment).to.equal(MODEL_COMMIT);
    });

    it("reverts on empty batch (count = 0)", async function () {
      await expect(
        contract.connect(registrar).commitBatch(MODEL_COMMIT, BATCH_ROOT, 0)
      ).to.be.revertedWith("BioLedgerV2: empty batch");
    });

    it("reverts on zero batch root", async function () {
      await expect(
        contract.connect(registrar).commitBatch(MODEL_COMMIT, ethers.ZeroHash, 10)
      ).to.be.revertedWith("BioLedgerV2: zero batch root");
    });

    it("reverts if model not active", async function () {
      await ds(contract.connect(owner), ALT_DATASET);
      await contract.connect(validator).activateDataset(ALT_DATASET);
      await mdl(contract.connect(owner), ALT_MODEL, ALT_ARTIFACT, ALT_DATASET);
      // ALT_MODEL not activated
      await expect(
        contract.connect(registrar).commitBatch(ALT_MODEL, BATCH_ROOT, 10)
      ).to.be.revertedWith("BioLedgerV2: model not active");
    });

    it("reverts if caller lacks REGISTRAR_ROLE", async function () {
      await expect(
        contract.connect(addr1).commitBatch(MODEL_COMMIT, BATCH_ROOT, 10)
      ).to.be.reverted;
    });
  });

  // ── getLineage ──────────────────────────────────────────────────────────────
  describe("getLineage", function () {

    let inferenceId;

    beforeEach(async function () {
      await ds(contract.connect(owner), DATASET_HASH, METADATA_URI);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH, METADATA_URI);
      await contract.connect(validator).activateModel(MODEL_COMMIT);

      const tx   = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      inferenceId = await getInferenceId(contract, tx);
    });

    it("returns full lineage: inference → model → dataset", async function () {
      const [inf, model, dataset] = await contract.getLineage(inferenceId);

      // inference
      expect(inf.inferenceId).to.equal(inferenceId);
      expect(inf.modelCommitment).to.equal(MODEL_COMMIT);
      expect(inf.inputHash).to.equal(INPUT_HASH);
      expect(inf.outputHash).to.equal(OUTPUT_HASH);
      expect(inf.calledBy).to.equal(registrar.address);
      expect(inf.exists).to.be.true;

      // model
      expect(model.modelCommitment).to.equal(MODEL_COMMIT);
      expect(model.datasetHash).to.equal(DATASET_HASH);
      expect(model.modelArtifactHash).to.equal(ARTIFACT_HASH);
      expect(model.active).to.be.true;
      expect(model.exists).to.be.true;

      // dataset
      expect(dataset.datasetHash).to.equal(DATASET_HASH);
      expect(dataset.active).to.be.true;
      expect(dataset.exists).to.be.true;
    });

    it("reverts for unknown inferenceId", async function () {
      await expect(
        contract.getLineage(ethers.encodeBytes32String("does-not-exist"))
      ).to.be.revertedWith("BioLedgerV2: inference not found");
    });
  });

  // ── verifyZKProof placeholder ────────────────────────────────────────────────
  describe("verifyZKProof (placeholder)", function () {

    it("returns true for any proof bytes on a valid inferenceId", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      await contract.connect(validator).activateModel(MODEL_COMMIT);

      const tx  = await contract.connect(registrar).logInference(MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH);
      const id  = await getInferenceId(contract, tx);

      expect(await contract.verifyZKProof(id, "0x1234abcd")).to.be.true;
    });

    it("reverts for unknown inferenceId", async function () {
      await expect(
        contract.verifyZKProof(ethers.encodeBytes32String("fake-id"), "0x00")
      ).to.be.revertedWith("BioLedgerV2: inference not found");
    });
  });

  // ── View helpers ─────────────────────────────────────────────────────────────
  describe("View Helpers", function () {

    it("datasetExists returns false before registration", async function () {
      expect(await contract.datasetExists(DATASET_HASH)).to.be.false;
    });

    it("modelExists returns false before registration", async function () {
      expect(await contract.modelExists(MODEL_COMMIT)).to.be.false;
    });

    it("inferenceExists returns false for unknown id", async function () {
      expect(await contract.inferenceExists(INPUT_HASH)).to.be.false;
    });

    it("getDataset reverts for unregistered hash", async function () {
      await expect(
        contract.getDataset(DATASET_HASH)
      ).to.be.revertedWith("BioLedgerV2: dataset not found");
    });

    it("getModel reverts for unregistered commitment", async function () {
      await expect(
        contract.getModel(MODEL_COMMIT)
      ).to.be.revertedWith("BioLedgerV2: model not found");
    });

    it("getInference reverts for unknown id", async function () {
      await expect(
        contract.getInference(INPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: inference not found");
    });

    it("getBatch reverts for unknown id", async function () {
      await expect(
        contract.getBatch(INPUT_HASH)
      ).to.be.revertedWith("BioLedgerV2: batch not found");
    });
  });

  // ── End-to-end: mirrors register.py workflow ─────────────────────────────────
  describe("End-to-End (mirrors register.py flow)", function () {

    it("dataset → model → inference → lineage — all pass", async function () {
      // [1/4] Register + activate dataset
      await ds(contract.connect(owner), DATASET_HASH, METADATA_URI);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      expect(await contract.datasetIsActive(DATASET_HASH)).to.be.true;

      // [3/4] Register + activate model
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH, METADATA_URI);
      await contract.connect(validator).activateModel(MODEL_COMMIT);
      expect(await contract.modelIsActive(MODEL_COMMIT)).to.be.true;

      // Inference (mirrors app.py → blockchain.log_inference)
      const tx = await contract.connect(registrar).logInference(
        MODEL_COMMIT, INPUT_HASH, OUTPUT_HASH
      );
      const id = await getInferenceId(contract, tx);
      expect(id).to.not.equal(ethers.ZeroHash);
      expect(await contract.inferenceExists(id)).to.be.true;

      // Lineage traversal (mirrors blockchain.get_lineage)
      const [inf, model, dataset] = await contract.getLineage(id);
      expect(inf.inputHash).to.equal(INPUT_HASH);
      expect(model.modelArtifactHash).to.equal(ARTIFACT_HASH);
      expect(dataset.datasetHash).to.equal(DATASET_HASH);

      // Counters
      expect(await contract.datasetCount()).to.equal(1);
      expect(await contract.modelCount()).to.equal(1);
      expect(await contract.inferenceCount()).to.equal(1);
    });

    it("batch commit path — 100 inferences in one tx", async function () {
      await ds(contract.connect(owner), DATASET_HASH);
      await contract.connect(validator).activateDataset(DATASET_HASH);
      await mdl(contract.connect(owner), MODEL_COMMIT, ARTIFACT_HASH, DATASET_HASH);
      await contract.connect(validator).activateModel(MODEL_COMMIT);

      const BATCH_ROOT = ethers.encodeBytes32String("batch-root-e2e");
      const tx  = await contract.connect(registrar).commitBatch(MODEL_COMMIT, BATCH_ROOT, 100);
      const id  = await getBatchId(contract, tx);
      const rec = await contract.getBatch(id);

      expect(rec.inferenceCount).to.equal(100);
      expect(rec.batchRoot).to.equal(BATCH_ROOT);
      expect(await contract.batchCount()).to.equal(1);
    });
  });

});