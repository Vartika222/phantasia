const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

function fakeHash(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

const DATASET_HASH  = fakeHash("dataset-v1");
const DATASET_HASH2 = fakeHash("dataset-v2");
const MODEL_HASH    = fakeHash("model-v1");
const INPUT_HASH    = fakeHash("input-1");
const OUTPUT_HASH   = fakeHash("output-1");
const METADATA_URI  = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const REGISTRAR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE"));
const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));

async function deployFixture() {
  const [admin, registrar, user1, user2, user3] = await ethers.getSigners();

  const BioToken  = await ethers.getContractFactory("BioToken");
  const bioToken  = await BioToken.deploy(admin.address);

  const BioDAO    = await ethers.getContractFactory("BioDAO");
  const bioDAO    = await BioDAO.deploy(await bioToken.getAddress(), admin.address);

  const BioLedger = await ethers.getContractFactory("BioLedger");
  const bioLedger = await BioLedger.deploy(admin.address);

  await bioLedger.connect(admin).grantRole(REGISTRAR_ROLE, registrar.address);
  await bioLedger.connect(admin).grantRole(GOVERNANCE_ROLE, await bioDAO.getAddress());

  return { bioToken, bioDAO, bioLedger, admin, registrar, user1, user2, user3 };
}

// ── BioToken ──────────────────────────────────────────────────────────────────

describe("BioToken", function () {
  it("mints initial supply to deployer", async function () {
    const { bioToken, admin } = await loadFixture(deployFixture);
    const supply = await bioToken.totalSupply();
    expect(supply).to.equal(ethers.parseEther("10000000"));
    expect(await bioToken.balanceOf(admin.address)).to.equal(supply);
  });

  it("has correct name and symbol", async function () {
    const { bioToken } = await loadFixture(deployFixture);
    expect(await bioToken.name()).to.equal("BioLedger Token");
    expect(await bioToken.symbol()).to.equal("BIO");
  });

  it("supports vote delegation", async function () {
    const { bioToken, admin, user1 } = await loadFixture(deployFixture);
    await bioToken.connect(admin).transfer(user1.address, ethers.parseEther("100000"));
    await bioToken.connect(user1).delegate(user1.address);
    expect(await bioToken.getVotes(user1.address)).to.equal(ethers.parseEther("100000"));
  });
});

// ── Access Control ────────────────────────────────────────────────────────────

describe("BioLedger – Access Control", function () {
  it("reverts dataset registration from non-registrar", async function () {
    const { bioLedger, user1 } = await loadFixture(deployFixture);
    await expect(
      bioLedger.connect(user1).registerDatasetVersion(DATASET_HASH, "")
    ).to.be.revertedWithCustomError(bioLedger, "AccessControlUnauthorizedAccount");
  });

  it("pause blocks writes", async function () {
    const { bioLedger, admin, registrar } = await loadFixture(deployFixture);
    await bioLedger.connect(admin).pause();
    await expect(
      bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, "")
    ).to.be.revertedWithCustomError(bioLedger, "EnforcedPause");
  });

  it("unpause restores writes", async function () {
    const { bioLedger, admin, registrar } = await loadFixture(deployFixture);
    await bioLedger.connect(admin).pause();
    await bioLedger.connect(admin).unpause();
    await expect(
      bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI)
    ).to.emit(bioLedger, "DatasetVersionRegistered");
  });
});

// ── Dataset ───────────────────────────────────────────────────────────────────

describe("BioLedger – Dataset Registration", function () {
  it("registers a dataset and emits event", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await expect(
      bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI)
    ).to.emit(bioLedger, "DatasetVersionRegistered");
  });

  it("stores dataset struct correctly", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI);
    const ds = await bioLedger.getDataset(DATASET_HASH);
    expect(ds.datasetHash).to.equal(DATASET_HASH);
    expect(ds.version).to.equal(1);
    expect(ds.metadataURI).to.equal(METADATA_URI);
    expect(ds.registeredBy).to.equal(registrar.address);
    expect(ds.exists).to.be.true;
  });

  it("increments datasetCount", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, "");
    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH2, "");
    expect(await bioLedger.datasetCount()).to.equal(2);
  });

  it("reverts on duplicate dataset hash", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, "");
    await expect(
      bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, "")
    ).to.be.revertedWith("BioLedger: dataset already registered");
  });

  it("reverts on zero hash", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await expect(
      bioLedger.connect(registrar).registerDatasetVersion(ethers.ZeroHash, "")
    ).to.be.revertedWith("BioLedger: zero dataset hash");
  });

  it("datasetExists returns correct flags", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    expect(await bioLedger.datasetExists(DATASET_HASH)).to.be.false;
    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, "");
    expect(await bioLedger.datasetExists(DATASET_HASH)).to.be.true;
  });
});

// ── Model ─────────────────────────────────────────────────────────────────────

describe("BioLedger – Model Registration", function () {
  async function withDataset() {
    const ctx = await loadFixture(deployFixture);
    await ctx.bioLedger.connect(ctx.registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI);
    return ctx;
  }

  it("registers a model and emits event", async function () {
    const { bioLedger, registrar } = await withDataset();
    await expect(
      bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, METADATA_URI)
    ).to.emit(bioLedger, "ModelVersionRegistered");
  });

  it("stores model struct with correct dataset link", async function () {
    const { bioLedger, registrar } = await withDataset();
    await bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, METADATA_URI);
    const m = await bioLedger.getModel(MODEL_HASH);
    expect(m.modelHash).to.equal(MODEL_HASH);
    expect(m.datasetHash).to.equal(DATASET_HASH);
    expect(m.version).to.equal(1);
    expect(m.exists).to.be.true;
  });

  it("reverts when dataset not registered", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await expect(
      bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, "")
    ).to.be.revertedWith("BioLedger: dataset not registered");
  });

  it("reverts on duplicate model hash", async function () {
    const { bioLedger, registrar } = await withDataset();
    await bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, "");
    await expect(
      bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, "")
    ).to.be.revertedWith("BioLedger: model already registered");
  });
});

// ── Inference ─────────────────────────────────────────────────────────────────

describe("BioLedger – Inference Logging", function () {
  async function withModel() {
    const ctx = await loadFixture(deployFixture);
    await ctx.bioLedger.connect(ctx.registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI);
    await ctx.bioLedger.connect(ctx.registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, METADATA_URI);
    return ctx;
  }

  async function getInferenceId(bioLedger, registrar) {
    const tx      = await bioLedger.connect(registrar).logInference(MODEL_HASH, INPUT_HASH, OUTPUT_HASH);
    const receipt = await tx.wait();
    const event   = receipt.logs.find((l) => {
      try { return bioLedger.interface.parseLog(l).name === "InferenceLogged"; } catch { return false; }
    });
    return bioLedger.interface.parseLog(event).args.inferenceId;
  }

  it("logs an inference and emits event", async function () {
    const { bioLedger, registrar } = await withModel();
    await expect(
      bioLedger.connect(registrar).logInference(MODEL_HASH, INPUT_HASH, OUTPUT_HASH)
    ).to.emit(bioLedger, "InferenceLogged");
  });

  it("stores inference struct correctly", async function () {
    const { bioLedger, registrar } = await withModel();
    const inferenceId = await getInferenceId(bioLedger, registrar);
    const inf = await bioLedger.getInference(inferenceId);
    expect(inf.modelHash).to.equal(MODEL_HASH);
    expect(inf.inputHash).to.equal(INPUT_HASH);
    expect(inf.outputHash).to.equal(OUTPUT_HASH);
    expect(inf.calledBy).to.equal(registrar.address);
    expect(inf.exists).to.be.true;
  });

  it("produces unique inferenceIds for same input via nonce", async function () {
    const { bioLedger, registrar } = await withModel();
    const id1 = await getInferenceId(bioLedger, registrar);
    const id2 = await getInferenceId(bioLedger, registrar);
    expect(id1).to.not.equal(id2);
  });

  it("reverts when model not registered", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);
    await expect(
      bioLedger.connect(registrar).logInference(MODEL_HASH, INPUT_HASH, OUTPUT_HASH)
    ).to.be.revertedWith("BioLedger: model not registered");
  });

  it("reverts on zero input hash", async function () {
    const { bioLedger, registrar } = await withModel();
    await expect(
      bioLedger.connect(registrar).logInference(MODEL_HASH, ethers.ZeroHash, OUTPUT_HASH)
    ).to.be.revertedWith("BioLedger: zero input hash");
  });
});

// ── Lineage ───────────────────────────────────────────────────────────────────

describe("BioLedger – Lineage", function () {
  it("getLineage returns full cryptographic chain", async function () {
    const { bioLedger, registrar } = await loadFixture(deployFixture);

    await bioLedger.connect(registrar).registerDatasetVersion(DATASET_HASH, METADATA_URI);
    await bioLedger.connect(registrar).registerModelVersion(MODEL_HASH, DATASET_HASH, METADATA_URI);

    const tx      = await bioLedger.connect(registrar).logInference(MODEL_HASH, INPUT_HASH, OUTPUT_HASH);
    const receipt = await tx.wait();
    const event   = receipt.logs.find((l) => {
      try { return bioLedger.interface.parseLog(l).name === "InferenceLogged"; } catch { return false; }
    });
    const inferenceId = bioLedger.interface.parseLog(event).args.inferenceId;

    const [inference, model, dataset] = await bioLedger.getLineage(inferenceId);

    expect(inference.modelHash).to.equal(MODEL_HASH);
    expect(model.datasetHash).to.equal(DATASET_HASH);
    expect(dataset.datasetHash).to.equal(DATASET_HASH);

    // Cryptographic consistency check
    expect(inference.modelHash).to.equal(model.modelHash);
    expect(model.datasetHash).to.equal(dataset.datasetHash);
  });
});

// ── BioDAO ────────────────────────────────────────────────────────────────────

describe("BioDAO – Governance", function () {
  async function mineBlocks(n) {
    for (let i = 0; i < n; i++) await ethers.provider.send("evm_mine", []);
  }

  it("reverts proposal below threshold", async function () {
    const { bioDAO, user1 } = await loadFixture(deployFixture);
    await expect(
      bioDAO.connect(user1).propose(ethers.ZeroAddress, "0x", "Spam")
    ).to.be.revertedWith("BioDAO: below proposal threshold");
  });

  it("full flow: propose → vote → pass", async function () {
    const { bioToken, bioDAO, admin, user1, user2 } = await loadFixture(deployFixture);

    await bioToken.connect(admin).transfer(user1.address, ethers.parseEther("500000"));
    await bioToken.connect(admin).transfer(user2.address, ethers.parseEther("500000"));
    await bioToken.connect(user1).delegate(user1.address);
    await bioToken.connect(user2).delegate(user2.address);
    await bioToken.connect(admin).delegate(admin.address);

    const tx      = await bioDAO.connect(user1).propose(admin.address, "0x", "Grant REGISTRAR_ROLE");
    const receipt = await tx.wait();
    const event   = receipt.logs.find((l) => {
      try { return bioDAO.interface.parseLog(l).name === "ProposalCreated"; } catch { return false; }
    });
    const proposalId = bioDAO.interface.parseLog(event).args.proposalId;

    await bioDAO.connect(user1).castVote(proposalId, true);
    await bioDAO.connect(user2).castVote(proposalId, true);
    await bioDAO.connect(admin).castVote(proposalId, true);

    await mineBlocks(50401);

    expect(await bioDAO.state(proposalId)).to.equal(3); // Passed
  });

  it("defeated without quorum", async function () {
    const { bioToken, bioDAO, admin, user1 } = await loadFixture(deployFixture);

    await bioToken.connect(admin).transfer(user1.address, ethers.parseEther("100001"));
    await bioToken.connect(user1).delegate(user1.address);

    const tx      = await bioDAO.connect(user1).propose(admin.address, "0x", "Low quorum");
    const receipt = await tx.wait();
    const event   = receipt.logs.find((l) => {
      try { return bioDAO.interface.parseLog(l).name === "ProposalCreated"; } catch { return false; }
    });
    const proposalId = bioDAO.interface.parseLog(event).args.proposalId;

    await bioDAO.connect(user1).castVote(proposalId, true);
    await mineBlocks(50401);

    expect(await bioDAO.state(proposalId)).to.equal(2); // Defeated
  });

  it("prevents double voting", async function () {
    const { bioToken, bioDAO, admin } = await loadFixture(deployFixture);

    await bioToken.connect(admin).delegate(admin.address);
    const tx      = await bioDAO.connect(admin).propose(admin.address, "0x", "Double vote test");
    const receipt = await tx.wait();
    const event   = receipt.logs.find((l) => {
      try { return bioDAO.interface.parseLog(l).name === "ProposalCreated"; } catch { return false; }
    });
    const proposalId = bioDAO.interface.parseLog(event).args.proposalId;

    await bioDAO.connect(admin).castVote(proposalId, true);
    await expect(
      bioDAO.connect(admin).castVote(proposalId, false)
    ).to.be.revertedWith("BioDAO: already voted");
  });
});