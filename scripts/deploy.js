const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log("\n============================================");
  console.log("  BioLedger V2 Deployment");
  console.log("============================================");
  console.log(`Network  : ${networkName}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(
    await ethers.provider.getBalance(deployer.address)
  )} ETH/MATIC\n`);

  // 1. BioToken
  console.log("1/3  Deploying BioToken...");
  const BioToken = await ethers.getContractFactory("BioToken");
  const bioToken = await BioToken.deploy(deployer.address);
  await bioToken.waitForDeployment();
  const bioTokenAddr = await bioToken.getAddress();
  console.log(`     BioToken     : ${bioTokenAddr}`);

  // 2. BioDAO
  console.log("2/3  Deploying BioDAO...");
  const BioDAO = await ethers.getContractFactory("BioDAO");
  const bioDAO = await BioDAO.deploy(bioTokenAddr, deployer.address);
  await bioDAO.waitForDeployment();
  const bioDAOAddr = await bioDAO.getAddress();
  console.log(`     BioDAO       : ${bioDAOAddr}`);

  // 3. BioLedgerV2
  console.log("3/3  Deploying BioLedgerV2...");
  const BioLedgerV2 = await ethers.getContractFactory("BioLedgerV2");
  const bioLedger   = await BioLedgerV2.deploy(deployer.address);
  await bioLedger.waitForDeployment();
  const bioLedgerAddr = await bioLedger.getAddress();
  console.log(`     BioLedgerV2  : ${bioLedgerAddr}`);

  // 4. Roles
  console.log("\nConfiguring roles...");
  const roles = {
    GOVERNANCE_ROLE:       ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE")),
    DATA_CONTRIBUTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DATA_CONTRIBUTOR_ROLE")),
    MODEL_TRAINER_ROLE:    ethers.keccak256(ethers.toUtf8Bytes("MODEL_TRAINER_ROLE")),
    VALIDATOR_ROLE:        ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE")),
    REGISTRAR_ROLE:        ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE")),
  };

  let tx = await bioLedger.grantRole(roles.GOVERNANCE_ROLE, bioDAOAddr);
  await tx.wait();
  console.log(`  GOVERNANCE_ROLE       → BioDAO (${bioDAOAddr})`);

  const roleEnvMap = {
    DATA_CONTRIBUTOR_ROLE: process.env.DATA_CONTRIBUTOR_WALLET,
    MODEL_TRAINER_ROLE:    process.env.MODEL_TRAINER_WALLET,
    VALIDATOR_ROLE:        process.env.VALIDATOR_WALLET,
    REGISTRAR_ROLE:        process.env.PIPELINE_WALLET,
  };

  for (const [roleName, wallet] of Object.entries(roleEnvMap)) {
    if (wallet && ethers.isAddress(wallet)) {
      tx = await bioLedger.grantRole(roles[roleName], wallet);
      await tx.wait();
      console.log(`  ${roleName.padEnd(22)} → ${wallet}`);
    }
  }

  // 5. Write artifact
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const artifact = {
    network:    networkName,
    chainId:    (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp:  new Date().toISOString(),
    version:    "2.0.0",
    deployer:   deployer.address,
    contracts: {
      BioToken:    bioTokenAddr,
      BioDAO:      bioDAOAddr,
      BioLedgerV2: bioLedgerAddr,
    },
    roles,
  };

  const outPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  console.log("\n============================================");
  console.log("  Deployment Complete");
  console.log("============================================");
  console.log(`BioToken    : ${bioTokenAddr}`);
  console.log(`BioDAO      : ${bioDAOAddr}`);
  console.log(`BioLedgerV2 : ${bioLedgerAddr}`);
  console.log(`\nArtifact    : deployments/${networkName}.json`);

  if (networkName === "polygonAmoy") {
    console.log("\nVerification commands:");
    console.log(`  npx hardhat verify --network polygonAmoy ${bioTokenAddr} "${deployer.address}"`);
    console.log(`  npx hardhat verify --network polygonAmoy ${bioDAOAddr} "${bioTokenAddr}" "${deployer.address}"`);
    console.log(`  npx hardhat verify --network polygonAmoy ${bioLedgerAddr} "${deployer.address}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});