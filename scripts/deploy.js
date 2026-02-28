const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log("\n========================================");
  console.log("  BioLedger Deployment");
  console.log("========================================");
  console.log(`Network  : ${networkName}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH/MATIC\n`);

  // 1. BioToken
  console.log("1/3  Deploying BioToken...");
  const BioToken = await ethers.getContractFactory("BioToken");
  const bioToken = await BioToken.deploy(deployer.address);
  await bioToken.waitForDeployment();
  const bioTokenAddress = await bioToken.getAddress();
  console.log(`     BioToken deployed at : ${bioTokenAddress}`);

  // 2. BioDAO
  console.log("2/3  Deploying BioDAO...");
  const BioDAO = await ethers.getContractFactory("BioDAO");
  const bioDAO = await BioDAO.deploy(bioTokenAddress, deployer.address);
  await bioDAO.waitForDeployment();
  const bioDAOAddress = await bioDAO.getAddress();
  console.log(`     BioDAO deployed at   : ${bioDAOAddress}`);

  // 3. BioLedger
  console.log("3/3  Deploying BioLedger...");
  const BioLedger = await ethers.getContractFactory("BioLedger");
  const bioLedger = await BioLedger.deploy(deployer.address);
  await bioLedger.waitForDeployment();
  const bioLedgerAddress = await bioLedger.getAddress();
  console.log(`     BioLedger deployed at: ${bioLedgerAddress}`);

  // 4. Grant GOVERNANCE_ROLE to BioDAO
  console.log("\nConfiguring roles...");
  const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));
  let tx = await bioLedger.grantRole(GOVERNANCE_ROLE, bioDAOAddress);
  await tx.wait();
  console.log(`  GOVERNANCE_ROLE → BioDAO (${bioDAOAddress})`);

  // 5. Optionally grant REGISTRAR_ROLE to pipeline wallet
  const pipelineWallet = process.env.PIPELINE_WALLET;
  if (pipelineWallet && ethers.isAddress(pipelineWallet)) {
    const REGISTRAR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE"));
    tx = await bioLedger.grantRole(REGISTRAR_ROLE, pipelineWallet);
    await tx.wait();
    console.log(`  REGISTRAR_ROLE  → Pipeline wallet (${pipelineWallet})`);
  }

  // 6. Write deployment artifact
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const artifact = {
    network:   networkName,
    chainId:   (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer:  deployer.address,
    contracts: {
      BioToken:  bioTokenAddress,
      BioDAO:    bioDAOAddress,
      BioLedger: bioLedgerAddress,
    },
  };

  const outPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  console.log("\n========================================");
  console.log("  Deployment Complete");
  console.log("========================================");
  console.log(`BioToken  : ${bioTokenAddress}`);
  console.log(`BioDAO    : ${bioDAOAddress}`);
  console.log(`BioLedger : ${bioLedgerAddress}`);
  console.log(`\nArtifact  : deployments/${networkName}.json`);

  if (networkName === "polygonAmoy") {
    console.log("\nVerification commands:");
    console.log(`  npx hardhat verify --network polygonAmoy ${bioTokenAddress} "${deployer.address}"`);
    console.log(`  npx hardhat verify --network polygonAmoy ${bioDAOAddress} "${bioTokenAddress}" "${deployer.address}"`);
    console.log(`  npx hardhat verify --network polygonAmoy ${bioLedgerAddress} "${deployer.address}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});